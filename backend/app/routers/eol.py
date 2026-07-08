import httpx, logging, re
from datetime import datetime, date, timezone
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
from app.database import get_db
from app.middleware.auth import require_admin, require_editor, require_viewer
from app.models.eol import EolProduct, EolCycle, EolSyncStatus
from app.models.audit import ActivityType
from app.services import audit_service

router = APIRouter(tags=["EOL"])


# Utilidad: matching asset ↔ producto EOL por versión exacta
# Misma lógica que tagging_service.apply_eol_tags — fuente única de verdad
_OS_MAP = [
    ("ubuntu",         r"(\d+\.\d+)", "ubuntu"),
    ("debian",         r"(\d+)",        "debian"),
    ("rhel",           r"(\d+)",        "rhel"),
    ("red hat",        r"(\d+)",        "rhel"),
    ("centos",         r"(\d+)",        "centos"),
    ("windows server", r"(\d{4})",      "windows-server"),
    ("windows-server", r"(\d{4})",      "windows-server"),
    ("amazon linux",   r"(\d+)",        "amazon-linux"),
    ("rocky linux",    r"(\d+)",        "rocky-linux"),
    ("rocky",          r"(\d+)",        "rocky-linux"),
    ("almalinux",      r"(\d+)",        "almalinux"),
]
_DB_MAP = [
    ("postgresql", "postgresql"), ("postgres",   "postgresql"),
    ("sqlserver",  "mssqlserver"),("sql server",  "mssqlserver"),
    ("mysql",      "mysql"),      ("mariadb",     "mariadb"),
    ("mongodb",    "mongodb"),    ("mongo",       "mongodb"),
    ("redis",      "redis"),
]

def _eol_status_for_asset_and_product(asset, product_cycles: dict) -> str | None:
    """
    Devuelve el eol_status ('eol'|'warning'|'ok') del ciclo que mejor coincide
    con el asset para un conjunto de ciclos de un producto dado.
    product_cycles = {cycle_name: eol_status}
    Retorna None si no hay match.
    """
    if not product_cycles:
        return None
    candidates = []
    # OS matching
    if asset.os:
        os_l = asset.os.lower()
        for keyword, pattern, slug in _OS_MAP:
            if keyword in os_l:
                # Verificar que este producto corresponde a este slug
                # (se filtra en el llamador pasando solo ciclos del producto correcto)
                m = re.search(pattern, asset.os)
                if m:
                    ver = m.group(1)
                    candidates.append(ver)
                    major = ver.split(".")[0]
                    if major != ver:
                        candidates.append(major)
                break
    # DB matching
    if asset.db_engine:
        eng_l = asset.db_engine.lower()
        for kw, slug in _DB_MAP:
            if kw in eng_l:
                if asset.db_version:
                    m = re.search(r"(\d+\.\d+)", asset.db_version)
                    if m: candidates.append(m.group(1))
                    m2 = re.search(r"(\d+)", asset.db_version)
                    if m2: candidates.append(m2.group(1))
                break
    # Cisco
    if asset.vendor and "cisco" in (asset.vendor or "").lower() and asset.firmware_version:
        m = re.search(r"(\d+\.\d+)", asset.firmware_version)
        if m:
            candidates.append(m.group(1))

    # Kubernetes
    k8s_ver = getattr(asset, 'k8s_version', None)
    asset_type_str = str(getattr(asset, 'type', '')).split('.')[-1] if hasattr(asset, 'type') else ''
    if k8s_ver and asset_type_str == 'k8s_cluster':
        m = re.search(r"(\d+\.\d+)", k8s_ver)
        if m:
            candidates.append(m.group(1))
            major = m.group(1).split('.')[0]
            if major != m.group(1):
                candidates.append(major)

    STATUS_ORDER = {"eol": 0, "warning": 1, "ok": 2}
    worst = None
    for ver in candidates:
        st = product_cycles.get(ver) or product_cycles.get(ver.split(".")[0])
        if st and st != "unknown":
            if worst is None or STATUS_ORDER.get(st, 9) < STATUS_ORDER.get(worst, 9):
                worst = st
    return worst

def _asset_matches_product(asset, product_id: str) -> bool:
    """True si el OS/DB/firmware del asset corresponde a este product_id."""
    if asset.os:
        os_l = asset.os.lower()
        for keyword, pattern, slug in _OS_MAP:
            if slug == product_id and keyword in os_l:
                return True
    if asset.db_engine:
        eng_l = asset.db_engine.lower()
        for kw, slug in _DB_MAP:
            if slug == product_id and kw in eng_l:
                return True
    if product_id in ("cisco-ios", "cisco-ios-xe"):
        if asset.vendor and "cisco" in (asset.vendor or "").lower() and asset.firmware_version:
            slug = "cisco-ios-xe" if "xe" in (asset.model or "").lower() else "cisco-ios"
            if slug == product_id:
                return True
    # Kubernetes
    if product_id == "kubernetes":
        k8s_ver = getattr(asset, 'k8s_version', None)
        asset_type_str = str(getattr(asset, 'type', '')).split('.')[-1] if hasattr(asset, 'type') else ''
        if k8s_ver and asset_type_str == 'k8s_cluster':
            return True
    return False

logger = logging.getLogger("tfg.eol")

EOL_API = "https://endoflife.date/api"

# Pydantic schemas

class ProductUpdate(BaseModel):
    display_name: Optional[str] = None
    category: Optional[str] = None
    notes: Optional[str] = None

class CycleUpdate(BaseModel):
    custom_eol_date: Optional[date] = None
    custom_notes: Optional[str] = None

class CustomCycleCreate(BaseModel):
    """Para crear un ciclo EOL personalizado sin depender de endoflife.date."""
    cycle: str          # versión — ej: "2.3.1", "latest", "v4"
    eol_date: date      # fecha de fin de soporte
    notes: Optional[str] = None

# Helper: sync un producto desde la API externa

async def _sync_product(db: Session, product_id: str) -> dict:
    """Descarga los ciclos de un producto y actualiza la BD. Devuelve stats."""
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.get(f"{EOL_API}/{product_id}.json")
        if r.status_code == 404:
            raise HTTPException(404, f"Producto '{product_id}' no encontrado en endoflife.date")
        r.raise_for_status()
        cycles_data = r.json()

    now = datetime.now(timezone.utc)
    api_cycles = set()
    created = updated = 0

    for item in cycles_data:
        cycle_str = str(item.get("cycle", ""))
        api_cycles.add(cycle_str)

        # Parsear eol — puede ser fecha string, true o false
        eol_raw = item.get("eol")
        eol_date = None
        eol_bool = None
        if isinstance(eol_raw, bool):
            eol_bool = eol_raw
        elif isinstance(eol_raw, str):
            try: eol_date = date.fromisoformat(eol_raw)
            except ValueError: pass

        support_raw = item.get("support") or item.get("supportedUntil")
        support_end = None
        if isinstance(support_raw, str):
            try: support_end = date.fromisoformat(support_raw)
            except ValueError: pass

        release_raw = item.get("releaseDate") or item.get("release")
        release_date = None
        if isinstance(release_raw, str):
            try: release_date = date.fromisoformat(release_raw)
            except ValueError: pass

        lts_raw = item.get("lts", False)
        lts = lts_raw if isinstance(lts_raw, bool) else bool(lts_raw)

        existing = db.query(EolCycle).filter_by(product_id=product_id, cycle=cycle_str).first()
        if existing:
            existing.eol_date = eol_date
            existing.eol_boolean = eol_bool
            existing.support_end = support_end
            existing.release_date = release_date
            existing.lts = lts
            existing.latest = item.get("latest")
            existing.link = item.get("link")
            existing.sync_status = EolSyncStatus.synced
            existing.last_synced_at = now
            existing.raw_data = item
            updated += 1
        else:
            db.add(EolCycle(
                product_id=product_id, cycle=cycle_str,
                eol_date=eol_date, eol_boolean=eol_bool,
                support_end=support_end, release_date=release_date,
                lts=lts, latest=item.get("latest"), link=item.get("link"),
                sync_status=EolSyncStatus.synced, last_synced_at=now,
                raw_data=item,
            ))
            created += 1

    # Marcar como unsynced ciclos que ya no están en la API
    all_local = db.query(EolCycle).filter_by(product_id=product_id).all()
    unsynced = 0
    for c in all_local:
        if c.cycle not in api_cycles:
            c.sync_status = EolSyncStatus.unsynced
            unsynced += 1

    # Actualizar producto
    prod = db.query(EolProduct).filter_by(product_id=product_id).first()
    if prod:
        prod.sync_status = EolSyncStatus.synced
        prod.last_synced_at = now

    # Recalcular etiquetas EOL en todos los assets afectados
    try:
        from app.models.asset import Asset
        from app.services.tagging_service import apply_eol_tags
        assets = db.query(Asset).all()
        for asset in assets:
            try:
                apply_eol_tags(db, asset)
            except Exception as e:
                logger.warning(f"EOL retag failed for {asset.id}: {e}")
    except Exception as e:
        logger.warning(f"EOL tag update failed: {e}")

    db.commit()
    return {"product_id": product_id, "created": created, "updated": updated, "unsynced": unsynced}

# Endpoints: productos

@router.get("/v1/eol/all-products")
async def list_all_eol_products(user=Depends(require_viewer)):
    """Lista todos los productos disponibles en endoflife.date (no requiere BD)."""
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.get(f"{EOL_API}/all.json")
        r.raise_for_status()
    return r.json()

@router.get("/v1/eol/products")
def list_products(db: Session = Depends(get_db), user=Depends(require_viewer)):
    """Lista los productos guardados en BD."""
    products = db.query(EolProduct).order_by(EolProduct.product_id).all()
    result = []
    for p in products:
        d = p.to_dict()
        d["cycle_count"] = db.query(EolCycle).filter_by(product_id=p.product_id).count()
        # Conteo de ciclos por estado (para info interna)
        cycles_all = db.query(EolCycle).filter_by(product_id=p.product_id).all()
        d["eol_count"]     = sum(1 for c in cycles_all if c.eol_status == "eol")
        d["warning_count"] = sum(1 for c in cycles_all if c.eol_status == "warning")
        # Matching por producto+versión usando funciones helper reutilizables
        try:
            from app.models.asset import Asset as AssetModel
            pid = p.product_id
            product_cycles = {
                cyc.cycle: cyc.eol_status
                for cyc in db.query(EolCycle).filter_by(product_id=pid).all()
            }
            if not product_cycles:
                d["asset_eol_ko"] = d["asset_eol_warn"] = d["asset_eol_ok"] = d["asset_eol_unknown"] = 0
                d["asset_eol_ko_ids"] = d["asset_eol_warn_ids"] = d["asset_eol_ok_ids"] = d["asset_eol_unknown_ids"] = []
                result.append(d)
                continue

            ko_ids, warn_ids, ok_ids, unknown_ids = [], [], [], []
            for asset in db.query(AssetModel).all():
                if not _asset_matches_product(asset, pid):
                    continue
                st = _eol_status_for_asset_and_product(asset, product_cycles)
                if st == "eol":      ko_ids.append(asset.id)
                elif st == "warning": warn_ids.append(asset.id)
                elif st == "ok":      ok_ids.append(asset.id)
                else:                unknown_ids.append(asset.id)  # matched product but no version/date info

            d["asset_eol_ko"]       = len(ko_ids)
            d["asset_eol_warn"]     = len(warn_ids)
            d["asset_eol_ok"]       = len(ok_ids)
            d["asset_eol_unknown"]  = len(unknown_ids)
            d["asset_eol_ko_ids"]   = ko_ids
            d["asset_eol_warn_ids"] = warn_ids
            d["asset_eol_ok_ids"]   = ok_ids
            d["asset_eol_unknown_ids"] = unknown_ids
        except Exception as ex:
            logger.warning(f"EOL asset count error for {p.product_id}: {ex}")
            d["asset_eol_ko"] = d["asset_eol_warn"] = d["asset_eol_ok"] = d["asset_eol_unknown"] = 0
            d["asset_eol_ko_ids"] = d["asset_eol_warn_ids"] = d["asset_eol_ok_ids"] = d["asset_eol_unknown_ids"] = []
        result.append(d)
    return result

@router.post("/v1/eol/products/{product_id}", status_code=201)
async def add_product(product_id: str, body: ProductUpdate = ProductUpdate(),
                      db: Session = Depends(get_db), user=Depends(require_admin)):
    """Añade un producto a la BD y hace la primera sync."""
    existing = db.query(EolProduct).filter_by(product_id=product_id).first()
    if existing:
        raise HTTPException(409, f"El producto '{product_id}' ya existe")
    prod = EolProduct(
        product_id=product_id,
        display_name=body.display_name or product_id,
        category=body.category,
        notes=body.notes,
    )
    db.add(prod); db.flush()
    stats = await _sync_product(db, product_id)
    audit_service.record(db, ActivityType.EOL_SYNC, user=user,
        entity_type="eol_product", entity_id=product_id, entity_name=product_id,
        after={"created": stats.get("created",0), "updated": stats.get("updated",0),
               "display_name": body.display_name})
    db.commit()
    return {"product": prod.to_dict(), "sync": stats}

@router.put("/v1/eol/products/{product_id}")
def update_product(product_id: str, body: ProductUpdate,
                   db: Session = Depends(get_db), user=Depends(require_admin)):
    """Actualiza nombre, categoría o notas del producto (valores custom)."""
    prod = db.query(EolProduct).filter_by(product_id=product_id).first()
    if not prod: raise HTTPException(404, "Producto no encontrado")
    before = prod.to_dict()
    if body.display_name is not None: prod.display_name = body.display_name
    if body.category is not None:     prod.category = body.category
    if body.notes is not None:        prod.notes = body.notes
    audit_service.record(db, ActivityType.UPDATE, user=user,
        entity_type="eol_product", entity_id=product_id,
        entity_name=prod.display_name, before=before, after=prod.to_dict())
    db.commit()
    return prod.to_dict()

@router.delete("/v1/eol/products/{product_id}", status_code=204)
def delete_product(product_id: str, db: Session = Depends(get_db), user=Depends(require_admin)):
    """Elimina producto y todos sus ciclos de la BD."""
    prod = db.query(EolProduct).filter_by(product_id=product_id).first()
    if not prod: raise HTTPException(404, "Producto no encontrado")
    db.query(EolCycle).filter_by(product_id=product_id).delete()
    audit_service.record(db, ActivityType.DELETE, user=user,
        entity_type="eol_product", entity_id=product_id,
        entity_name=prod.display_name, before=prod.to_dict())
    db.delete(prod); db.commit()

@router.post("/v1/eol/products/{product_id}/sync")
async def sync_product(product_id: str, db: Session = Depends(get_db), user=Depends(require_admin)):
    """Sincroniza un producto concreto con endoflife.date."""
    prod = db.query(EolProduct).filter_by(product_id=product_id).first()
    if not prod: raise HTTPException(404, "Producto no encontrado")
    stats = await _sync_product(db, product_id)
    return stats

@router.post("/v1/eol/sync-all")
async def sync_all(db: Session = Depends(get_db), user=Depends(require_admin)):
    """Sincroniza TODOS los productos de la BD con endoflife.date (tarea diaria manual)."""
    products = db.query(EolProduct).all()
    results = []
    for p in products:
        try:
            stats = await _sync_product(db, p.product_id)
            results.append(stats)
        except Exception as e:
            logger.error(f"Sync failed for {p.product_id}: {e}")
            results.append({"product_id": p.product_id, "error": str(e)})
    audit_service.record(db, ActivityType.EOL_SYNC_ALL, user=user,
        entity_type="eol_product",
        after={"synced": len(results), "total_created": sum(r.get("created",0) for r in results),
               "total_updated": sum(r.get("updated",0) for r in results)})
    db.commit()
    return {"synced": len(results), "results": results}

# Endpoints: ciclos

@router.get("/v1/eol/products/{product_id}/cycles")
def list_cycles(product_id: str, db: Session = Depends(get_db), user=Depends(require_viewer)):
    prod = db.query(EolProduct).filter_by(product_id=product_id).first()
    if not prod: raise HTTPException(404, "Producto no encontrado")
    cycles = db.query(EolCycle).filter_by(product_id=product_id)\
               .order_by(EolCycle.release_date.desc()).all()
    return {"product": prod.to_dict(), "cycles": [c.to_dict() for c in cycles]}

@router.put("/v1/eol/products/{product_id}/cycles/{cycle_id}")
def update_cycle(product_id: str, cycle_id: str, body: CycleUpdate,
                 db: Session = Depends(get_db), user=Depends(require_admin)):
    """Sobrescribe fecha EOL o notas de un ciclo y recalcula etiquetas + dashboard."""
    from app.models.asset import Asset as AssetModel
    from app.services.tagging_service import apply_eol_tags

    cyc = db.query(EolCycle).filter_by(id=cycle_id, product_id=product_id).first()
    if not cyc: raise HTTPException(404, "Ciclo no encontrado")

    changed = False
    if body.custom_eol_date is not None:
        cyc.custom_eol_date = body.custom_eol_date
        changed = True
    if body.custom_notes is not None:
        cyc.custom_notes = body.custom_notes
    db.flush()

    # Si cambió la fecha → recalcular etiquetas EOL en los assets afectados
    updated_assets = 0
    if changed:
        for asset in db.query(AssetModel).all():
            # Solo recalcular si el asset puede pertenecer a este producto
            if _asset_matches_product(asset, product_id):
                try:
                    apply_eol_tags(db, asset)
                    updated_assets += 1
                except Exception as e:
                    logger.warning(f"EOL retag failed for {asset.id}: {e}")

    audit_service.record(db, ActivityType.EOL_OVERRIDE, user=user,
        entity_type="eol_cycle",
        entity_id=cyc.id,
        entity_name=f"{product_id}/{cyc.cycle}",
        after={"custom_eol_date": str(cyc.custom_eol_date) if cyc.custom_eol_date else None,
               "custom_notes": cyc.custom_notes,
               "retag_updated": updated_assets})
    db.commit()
    return {**cyc.to_dict(), "retag_updated": updated_assets}

# Endpoint: matching con activos

@router.get("/v1/eol/asset-status")
def asset_eol_status(db: Session = Depends(get_db), user=Depends(require_viewer)):
    """
    Devuelve el estado EOL calculado para cada activo del inventario,
    cruzando vendor/os/db_engine con los ciclos de endoflife.date.
    """
    from app.models.asset import Asset
    assets = db.query(Asset).all()
    result = []
    for a in assets:
        matches = _match_asset_to_cycles(db, a)
        result.append({
            "asset_id": a.id,
            "asset_name": a.name,
            "asset_type": str(a.type).split(".")[-1] if a.type else None,
            "matches": matches,
        })
    return result

def _match_asset_to_cycles(db: Session, asset) -> list:
    """Intenta buscar ciclos EOL relevantes para un activo."""
    matches = []
    search_terms = []

    # OS → ej: "Ubuntu 22.04" → buscar producto "ubuntu" ciclo "22.04"
    if asset.os:
        os_lower = asset.os.lower()
        for prod_slug in ["ubuntu","debian","rhel","centos","windows-server","amazon-linux","rocky-linux","almalinux"]:
            if prod_slug.replace("-"," ") in os_lower or prod_slug in os_lower:
                search_terms.append(prod_slug)
                break

    # DB engine → ej: "postgresql" → buscar producto "postgresql"
    if hasattr(asset, 'db_engine') and asset.db_engine:
        eng = asset.db_engine.lower()
        eng_map = {"postgresql":"postgresql","postgres":"postgresql","sqlserver":"mssqlserver",
                   "mysql":"mysql","mariadb":"mariadb","oracle":"oracle-db","mongodb":"mongodb",
                   "redis":"redis","elasticsearch":"elasticsearch"}
        for k,v in eng_map.items():
            if k in eng: search_terms.append(v); break

    for prod_id in search_terms:
        prod = db.query(EolProduct).filter_by(product_id=prod_id).first()
        if not prod: continue
        # Intentar extraer versión del OS
        version = _extract_version(asset.os or asset.db_version or "", prod_id)
        if version:
            cycle = db.query(EolCycle).filter_by(product_id=prod_id, cycle=version).first()
            if cycle:
                matches.append({
                    "product_id": prod_id,
                    "display_name": prod.display_name or prod_id,
                    "cycle": cycle.cycle,
                    "eol_status": cycle.eol_status,
                    "effective_eol_date": cycle.effective_eol_date.isoformat() if cycle.effective_eol_date else None,
                    "custom": cycle.custom_eol_date is not None,
                })
    return matches

def _extract_version(text: str, product: str) -> Optional[str]:
        # Buscar patrón numérico de versión en el texto
    patterns = [
        r'\b(\d+\.\d+)\b',   # X.Y → "22.04", "3.11"
        r'\b(\d+)\b',         # X → "9", "8"
    ]
    for p in patterns:
        m = re.search(p, text)
        if m: return m.group(1)
    return None

@router.post("/v1/eol/recalculate-tags")
async def recalculate_eol_tags(db: Session = Depends(get_db), user=Depends(require_admin)):
    """Recalcula etiquetas EOL (EOL KO/WARN/OK) en todos los activos del inventario."""
    from app.models.asset import Asset
    from app.services.tagging_service import apply_eol_tags
    assets = db.query(Asset).all()
    updated = 0
    for asset in assets:
        try:
            apply_eol_tags(db, asset)
            updated += 1
        except Exception as e:
            logger.warning(f"EOL tag failed for {asset.id}: {e}")
    db.commit()
    audit_service.record(db, ActivityType.EOL_RETAG, user=user,
        entity_type="eol_product", after={"updated_assets": updated})
    db.commit()
    return {"updated": updated, "message": f"Etiquetas EOL recalculadas en {updated} activos"}

@router.get("/v1/eol/products/{product_id}/assets")
def product_eol_assets(product_id: str, status: Optional[str] = Query(None),
                       db: Session = Depends(get_db), user=Depends(require_viewer)):
    """
    Devuelve los assets cuyo OS/DB/firmware coincide con este producto Y cuyo
    ciclo de versión tiene el eol_status solicitado.
    Matching idéntico a list_products y a apply_eol_tags.
    """
    from app.models.asset import Asset as AssetModel

    prod = db.query(EolProduct).filter_by(product_id=product_id).first()
    if not prod:
        raise HTTPException(404, "Producto no encontrado")

    # Cargar ciclos del producto
    product_cycles = {
        cyc.cycle: cyc.eol_status
        for cyc in db.query(EolCycle).filter_by(product_id=product_id).all()
    }
    if not product_cycles:
        return []

    result = []
    for asset in db.query(AssetModel).all():
        # 1. ¿El asset corresponde a este producto por OS/DB/firmware?
        if not _asset_matches_product(asset, product_id):
            continue
        # 2. ¿Qué eol_status tiene según los ciclos de este producto?
        asset_status = _eol_status_for_asset_and_product(asset, product_cycles)
        if asset_status is None:
            continue
        # 3. Filtrar por el status solicitado
        if status and asset_status != status:
            continue
        result.append({
            "id":         asset.id,
            "name":       asset.name,
            "type":       str(asset.type).split(".")[-1] if asset.type else None,
            "ips":        asset.ips,
            "os":         asset.os,
            "db_engine":  asset.db_engine,
            "db_version": asset.db_version,
            "eol_status": asset_status,
            "version_matched": next(
                (v for v in ([asset.os, asset.db_version] if asset.os or asset.db_version else [])
                 if v), None
            ),
        })

    return result

@router.get("/v1/eol/products/{product_id}/assets/unknown")
def product_eol_assets_unknown(product_id: str,
                                db: Session = Depends(get_db), user=Depends(require_viewer)):
    """
    Devuelve los assets que coinciden con este producto (por OS/DB/firmware)
    pero cuya versión no pudo mapearse a un ciclo EOL concreto.
    """
    from app.models.asset import Asset as AssetModel

    prod = db.query(EolProduct).filter_by(product_id=product_id).first()
    if not prod:
        raise HTTPException(404, "Producto no encontrado")

    product_cycles = {
        cyc.cycle: cyc.eol_status
        for cyc in db.query(EolCycle).filter_by(product_id=product_id).all()
    }

    result = []
    for asset in db.query(AssetModel).all():
        if not _asset_matches_product(asset, product_id):
            continue
        asset_status = _eol_status_for_asset_and_product(asset, product_cycles)
        if asset_status is not None:
            continue  # tiene status → no es "unknown"
        result.append({
            "id":         asset.id,
            "name":       asset.name,
            "type":       str(asset.type).split(".")[-1] if asset.type else None,
            "ips":        asset.ips,
            "os":         asset.os,
            "db_engine":  asset.db_engine,
            "db_version": asset.db_version,
            "firmware_version": asset.firmware_version,
            "eol_status": "unknown",
            "reason":     "Versión del activo no encontrada en los ciclos EOL del producto",
        })
    return result

# Auto-detección de productos

@router.get("/v1/eol/detected-products")
def get_detected_products(db: Session = Depends(get_db), user=Depends(require_viewer)):
    """
    Devuelve los product_ids que matchean con assets del inventario,
    separados en: ya_registrados (en BD) y sin_registrar (solo en assets).
    """
    from app.models.asset import Asset as AssetModel

    # Calcular qué product_ids matchean con cada asset
    all_slugs = set()
    for asset in db.query(AssetModel).all():
        # OS slugs
        if asset.os:
            os_l = asset.os.lower()
            for keyword, pattern, slug in _OS_MAP:
                if keyword in os_l:
                    all_slugs.add(slug)
                    break
        # DB slugs
        if asset.db_engine:
            eng_l = asset.db_engine.lower()
            for kw, slug in _DB_MAP:
                if kw in eng_l:
                    all_slugs.add(slug)
                    break
        # Cisco
        if asset.vendor and "cisco" in (asset.vendor or "").lower() and asset.firmware_version:
            slug = "cisco-ios-xe" if "xe" in (asset.model or "").lower() else "cisco-ios"
            all_slugs.add(slug)

    # Cuáles están ya en la BD
    registered = {p.product_id for p in db.query(EolProduct).all()}

    pending = sorted(all_slugs - registered)
    already = sorted(all_slugs & registered)

    # Enriquecer con conteo de assets por producto
    def asset_count(slug):
        return sum(1 for a in db.query(AssetModel).all() if _asset_matches_product(a, slug))

    return {
        "registered": [{"product_id": s, "asset_count": asset_count(s)} for s in already],
        "pending":    [{"product_id": s, "asset_count": asset_count(s)} for s in pending],
    }

@router.post("/v1/eol/auto-sync")
async def auto_sync_detected(db: Session = Depends(get_db), user=Depends(require_admin)):
    """
    Detecta automáticamente todos los productos que matchean con assets del inventario
    y los añade+sincroniza si aún no están registrados.
    """
    # Reutilizar detected-products
    from app.models.asset import Asset as AssetModel

    all_slugs = set()
    for asset in db.query(AssetModel).all():
        if asset.os:
            os_l = asset.os.lower()
            for keyword, pattern, slug in _OS_MAP:
                if keyword in os_l:
                    all_slugs.add(slug)
                    break
        if asset.db_engine:
            eng_l = asset.db_engine.lower()
            for kw, slug in _DB_MAP:
                if kw in eng_l:
                    all_slugs.add(slug)
                    break
        if asset.vendor and "cisco" in (asset.vendor or "").lower() and asset.firmware_version:
            slug = "cisco-ios-xe" if "xe" in (asset.model or "").lower() else "cisco-ios"
            all_slugs.add(slug)

    registered = {p.product_id for p in db.query(EolProduct).all()}
    pending = sorted(all_slugs - registered)

    results = []
    for slug in pending:
        try:
            # Intentar obtener de endoflife.date
            stats = await _sync_product(db, slug)
            results.append({"product_id": slug, "status": "synced",
                            "created": stats.get("created", 0)})
        except Exception as e:
            # Si no existe en la API, crear solo el producto (sin ciclos)
            logger.warning(f"Auto-sync: no API data for {slug}: {e}")
            existing = db.query(EolProduct).filter_by(product_id=slug).first()
            if not existing:
                prod = EolProduct(
                    product_id=slug,
                    display_name=slug.replace("-", " ").title(),
                    sync_status=EolSyncStatus.unsynced,
                )
                db.add(prod)
            results.append({"product_id": slug, "status": "no_api_data"})

    db.commit()

    # Recalcular etiquetas si se añadieron productos nuevos
    if any(r["status"] == "synced" for r in results):
        from app.services.tagging_service import apply_eol_tags
        updated = 0
        for asset in db.query(AssetModel).all():
            try:
                apply_eol_tags(db, asset)
                updated += 1
            except Exception:
                pass
        db.commit()

    audit_service.record(db, ActivityType.EOL_SYNC_ALL, user=user,
        entity_type="eol_product",
        after={"synced": len([r for r in results if r["status"]=="synced"]),
               "no_api_data": len([r for r in results if r["status"]=="no_api_data"]),
               "total_new": len(pending)})
    db.commit()

    return {"added": len(pending), "results": results}

@router.post("/v1/eol/products/{product_id}/custom-cycle", status_code=201)
def add_custom_cycle(product_id: str, body: CustomCycleCreate,
                     db: Session = Depends(get_db), user=Depends(require_admin)):
    """
    Añade un ciclo de vida custom a un producto existente.
    Útil para productos no cubiertos por endoflife.date (software interno, ERP propio...).
    Recalcula etiquetas automáticamente.
    """
    from app.models.asset import Asset as AssetModel
    from app.services.tagging_service import apply_eol_tags

    prod = db.query(EolProduct).filter_by(product_id=product_id).first()
    if not prod:
        raise HTTPException(404, "Producto no encontrado")

    # Crear o actualizar el ciclo
    existing = db.query(EolCycle).filter_by(product_id=product_id, cycle=body.cycle).first()
    if existing:
        existing.custom_eol_date = body.eol_date
        existing.custom_notes = body.notes
        cyc = existing
    else:
        cyc = EolCycle(
            product_id=product_id,
            cycle=body.cycle,
            custom_eol_date=body.eol_date,
            custom_notes=body.notes,
            eol_date=body.eol_date,  # también en eol_date para que eol_status funcione
            sync_status=EolSyncStatus.unsynced,
            last_synced_at=None,
        )
        db.add(cyc)
    db.flush()

    # Recalcular etiquetas en assets afectados
    updated = 0
    for asset in db.query(AssetModel).all():
        if _asset_matches_product(asset, product_id):
            try:
                apply_eol_tags(db, asset)
                updated += 1
            except Exception as e:
                logger.warning(f"EOL retag failed for {asset.id}: {e}")

    audit_service.record(db, ActivityType.EOL_OVERRIDE, user=user,
        entity_type="eol_cycle", entity_id=cyc.id,
        entity_name=f"{product_id}/{body.cycle}",
        after={"custom_eol_date": str(body.eol_date), "cycle": body.cycle,
               "retag_updated": updated, "custom": True})
    db.commit()

    return {**cyc.to_dict(), "retag_updated": updated}

