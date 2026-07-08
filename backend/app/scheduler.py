"""
scheduler.py — Tareas programadas del backend.

Lógica de auto-sync EOL:
  - Al dar de alta un asset (POST ingest/CREATE): se detecta si su OS/DB matchea
    un producto EOL no registrado → se añade y sincroniza automáticamente.
  - Diariamente a las 05:00 (Europe/Madrid): re-sync de todos los productos
    ya registrados + nuevos detectados + recálculo de etiquetas.
"""
import logging
from datetime import datetime, timezone
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

logger = logging.getLogger("tfg.scheduler")
scheduler = AsyncIOScheduler(timezone="Europe/Madrid")

def _detect_slugs_for_asset(asset, OS_MAP, DB_MAP) -> set:
    """Calcula qué product_ids EOL matchean con un asset concreto."""
    slugs = set()
    if asset.os:
        os_l = asset.os.lower()
        for keyword, _, slug in OS_MAP:
            if keyword in os_l:
                slugs.add(slug); break
    if asset.db_engine:
        eng_l = asset.db_engine.lower()
        for kw, slug in DB_MAP:
            if kw in eng_l:
                slugs.add(slug); break
    if asset.vendor and "cisco" in (asset.vendor or "").lower() and asset.firmware_version:
        slug = "cisco-ios-xe" if "xe" in (asset.model or "").lower() else "cisco-ios"
        slugs.add(slug)
    return slugs

async def auto_sync_new_asset(asset_os=None, asset_db_engine=None,
                               asset_vendor=None, asset_model=None,
                               asset_firmware=None):
    """
    Llamado al crear/ingestar un asset nuevo.
    Si el asset matchea un producto EOL no registrado, lo añade y sincroniza.
    Retorna el número de productos nuevos añadidos.
    """
    # Simular un asset para _detect_slugs
    class FakeAsset:
        os = asset_os; db_engine = asset_db_engine
        vendor = asset_vendor; model = asset_model
        firmware_version = asset_firmware

    try:
        from app.routers.eol import _OS_MAP, _DB_MAP, _sync_product
        slugs = _detect_slugs_for_asset(FakeAsset(), _OS_MAP, _DB_MAP)
        if not slugs:
            return 0

        from app.database import SessionLocal
        from app.models.eol import EolProduct, EolSyncStatus
        from app.models.asset import Asset
        from app.services.tagging_service import apply_eol_tags
        from app.routers.eol import _asset_matches_product

        db = SessionLocal()
        try:
            registered = {p.product_id for p in db.query(EolProduct).all()}
            new_slugs = [s for s in slugs if s not in registered]
            added = 0

            for slug in new_slugs:
                try:
                    await _sync_product(db, slug)
                    logger.info(f"[AUTO-SYNC] New EOL product on asset creation: {slug}")
                    added += 1
                except Exception as e:
                    logger.warning(f"[AUTO-SYNC] No API data for {slug}: {e}")
                    if not db.query(EolProduct).filter_by(product_id=slug).first():
                        db.add(EolProduct(
                            product_id=slug,
                            display_name=slug.replace("-", " ").title(),
                            sync_status=EolSyncStatus.unsynced,
                        ))

            db.commit()

            # Recalcular etiquetas en assets que usen los nuevos productos
            if added > 0:
                for asset in db.query(Asset).all():
                    for slug in new_slugs:
                        if _asset_matches_product(asset, slug):
                            try:
                                apply_eol_tags(db, asset)
                            except Exception:
                                pass
                db.commit()

            return added
        finally:
            db.close()
    except Exception as e:
        logger.error(f"auto_sync_new_asset failed: {e}", exc_info=True)
        return 0

async def daily_eol_sync():
    """
    05:00 diario (Europe/Madrid):
    1. Detectar product_ids en assets no registrados → añadir y sincronizar
    2. Resync de productos ya registrados (actualizar ciclos)
    3. Recalcular etiquetas EOL en todos los assets
    """
    logger.info("[SCHEDULER] daily_eol_sync starting...")
    try:
        from app.database import SessionLocal
        from app.models.eol import EolProduct, EolSyncStatus
        from app.models.asset import Asset
        from app.routers.eol import _sync_product, _OS_MAP, _DB_MAP
        from app.services.tagging_service import apply_eol_tags

        db = SessionLocal()
        try:
            # 1. Detectar slugs en todos los assets
            all_slugs = set()
            for asset in db.query(Asset).all():
                all_slugs |= _detect_slugs_for_asset(asset, _OS_MAP, _DB_MAP)

            registered = {p.product_id for p in db.query(EolProduct).all()}

            # 2. Añadir nuevos
            new_added = 0
            for slug in sorted(all_slugs - registered):
                try:
                    await _sync_product(db, slug)
                    logger.info(f"Auto-added: {slug}")
                    new_added += 1
                except Exception as e:
                    logger.warning(f"No API data for {slug}: {e}")
                    if not db.query(EolProduct).filter_by(product_id=slug).first():
                        db.add(EolProduct(
                            product_id=slug,
                            display_name=slug.replace("-", " ").title(),
                            sync_status=EolSyncStatus.unsynced,
                        ))

            # 3. Resync de productos ya registrados
            for prod in db.query(EolProduct).filter_by(sync_status=EolSyncStatus.synced).all():
                try:
                    await _sync_product(db, prod.product_id)
                except Exception:
                    pass

            db.commit()

            # 4. Recalcular todas las etiquetas EOL
            updated = 0
            for asset in db.query(Asset).all():
                try:
                    apply_eol_tags(db, asset)
                    updated += 1
                except Exception:
                    pass
            db.commit()
            logger.info(f"[SCHEDULER] daily_eol_sync done — {new_added} new products, {updated} assets retagged")
        finally:
            db.close()
    except Exception as e:
        logger.error(f"[SCHEDULER] daily_eol_sync failed: {e}", exc_info=True)

async def daily_audit_cleanup():
    """
    02:00 diario (Europe/Madrid):
    Elimina audit logs con más de 180 días de antigüedad.
    """
    logger.info("[SCHEDULER] daily_audit_cleanup starting...")
    try:
        from app.database import SessionLocal
        from app.models.audit import AuditLog
        from datetime import timedelta

        db = SessionLocal()
        try:
            cutoff = datetime.now(timezone.utc) - timedelta(days=180)
            deleted = db.query(AuditLog).filter(AuditLog.timestamp < cutoff).delete()
            db.commit()
            logger.info(f"[SCHEDULER] daily_audit_cleanup done — {deleted} logs eliminados")
        finally:
            db.close()
    except Exception as e:
        logger.error(f"[SCHEDULER] daily_audit_cleanup failed: {e}", exc_info=True)
