import logging
from datetime import datetime, timezone
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from sqlalchemy import or_, cast, String, nullslast, nullsfirst, func, text
from app.database import get_db
from app.middleware.auth import require_admin, require_editor, require_viewer
from app.models.asset import Asset, AssetType
from app.models.tag import Tag
from app.models.audit import AuditLog
from app.models.exception import ComplianceException
from app.services import audit_service, history_service, tagging_service, asset_change_log as acl_svc
from app.models.audit import ActivityType

logger = logging.getLogger("tfg.assets")

def _auto_add_eol_for_asset(db, asset):
    """
    Detecta si el asset tiene OS/DB/firmware que corresponde a un producto EOL
    no registrado aún en la BD. Si es nuevo, lo añade (sin sincronizar desde API —
    eso lo hace el scheduler a las 5am o el usuario manualmente).
    También aplica las etiquetas EOL existentes.
    """
    try:
        from app.routers.eol import _OS_MAP, _DB_MAP
        from app.models.eol import EolProduct, EolSyncStatus
        from app.services.tagging_service import apply_eol_tags

        slugs = set()
        if asset.os:
            os_l = asset.os.lower()
            for keyword, _, slug in _OS_MAP:
                if keyword in os_l:
                    slugs.add(slug); break
        if asset.db_engine:
            eng_l = asset.db_engine.lower()
            for kw, slug in _DB_MAP:
                if kw in eng_l:
                    slugs.add(slug); break
        if asset.vendor and "cisco" in (asset.vendor or "").lower() and asset.firmware_version:
            slug = "cisco-ios-xe" if "xe" in (asset.model or "").lower() else "cisco-ios"
            slugs.add(slug)

        registered = {p.product_id for p in db.query(EolProduct).all()}
        for slug in slugs - registered:
            db.add(EolProduct(
                product_id=slug,
                display_name=slug.replace("-", " ").title(),
                sync_status=EolSyncStatus.unsynced,  # el scheduler lo sincronizará
            ))
            logger.info(f"Auto-registered EOL product '{slug}' for new asset '{asset.name}'")

        db.flush()
        # Aplicar etiquetas EOL
        apply_eol_tags(db, asset)
    except Exception as e:
        logger.warning(f"_auto_add_eol_for_asset failed for {asset.id}: {e}")

router = APIRouter(prefix="/v1/assets", tags=["Assets"])

SORT_FIELDS = {"name","type","vendor","source","last_sync","created_at","last_backup_local","last_backup_cloud"}

class BulkTagsRequest(BaseModel):
    asset_ids: List[str] = Field(..., min_length=1)
    tag_ids:   List[str] = Field(..., min_length=1)

class IngestAssetRequest(BaseModel):
    id: Optional[str] = None
    name: str = Field(..., max_length=255)
    type: AssetType
    ips: Optional[List[str]] = None
    mac_address: Optional[str] = Field(None, max_length=17)
    mac_addresses: Optional[List[str]] = None  # MACs adicionales solo para matching (no se almacenan)
    vendor: Optional[str] = Field(None, max_length=100)
    source: Optional[str] = Field(None, max_length=100)
    data_source_id: Optional[str] = None
    edr_installed: Optional[bool] = None; monitored: Optional[bool] = None
    siem_enabled: Optional[bool] = None; logs_enabled: Optional[bool] = None; monica_registered: Optional[bool] = None
    last_backup_local: Optional[datetime] = None; last_backup_cloud: Optional[datetime] = None
    ram_gb: Optional[int] = None; total_disk_gb: Optional[int] = None
    cpu_count: Optional[int] = None; os: Optional[str] = Field(None, max_length=100)
    model: Optional[str] = Field(None, max_length=100)
    port_count: Optional[int] = None; firmware_version: Optional[str] = Field(None, max_length=50)
    max_speed: Optional[str] = Field(None, max_length=50)
    coverage_area: Optional[str] = Field(None, max_length=100); connected_clients: Optional[int] = None
    db_engine: Optional[str] = Field(None, max_length=50); db_version: Optional[str] = Field(None, max_length=50)
    db_size_gb: Optional[int] = None; db_host: Optional[str] = Field(None, max_length=255)
    db_port: Optional[int] = None; db_replication: Optional[bool] = None; db_cluster: Optional[str] = None
    container_id: Optional[str] = Field(None, max_length=64)
    # Container details
    container_runtime: Optional[str] = Field(None, max_length=50)
    container_image: Optional[str] = Field(None, max_length=500)
    container_image_tag: Optional[str] = Field(None, max_length=100)
    container_status: Optional[str] = Field(None, max_length=20)
    container_ports: Optional[list] = None
    container_network: Optional[str] = Field(None, max_length=100)
    container_volumes: Optional[list] = None
    container_compose_project: Optional[str] = Field(None, max_length=100)
    container_compose_service: Optional[str] = Field(None, max_length=100)
    # K8s cluster
    k8s_version: Optional[str] = Field(None, max_length=20)
    k8s_provider: Optional[str] = Field(None, max_length=50)
    k8s_network_plugin: Optional[str] = Field(None, max_length=50)
    k8s_ingress_class: Optional[str] = Field(None, max_length=50)
    k8s_container_runtime: Optional[str] = Field(None, max_length=50)
    k8s_storage_class: Optional[str] = Field(None, max_length=100)
    k8s_control_plane_count: Optional[int] = None
    k8s_worker_count: Optional[int] = None
    k8s_nodes: Optional[list] = None
    k8s_namespaces: Optional[list] = None
    k8s_pods: Optional[list] = None
    k8s_deployments: Optional[list] = None
    k8s_helm_releases: Optional[list] = None
    serial_number: Optional[str] = Field(None, max_length=100)
    location: Optional[str] = Field(None, max_length=255); description: Optional[str] = None
    notes: Optional[str] = None
    # Producto / versión (todos los tipos)
    product_name: Optional[str] = Field(None, max_length=200)
    product_version: Optional[str] = Field(None, max_length=100)
    # Virtualización VMware
    vcenter_id: Optional[str] = None; vcenter_name: Optional[str] = Field(None, max_length=255)
    hypervisor_id: Optional[str] = None; hypervisor_name: Optional[str] = Field(None, max_length=255)
    vcenter_datacenter: Optional[str] = Field(None, max_length=255)
    vcenter_cluster: Optional[str] = Field(None, max_length=255)
    vm_power_state: Optional[str] = Field(None, max_length=20)
    vm_guest_os: Optional[str] = Field(None, max_length=200)
    vm_tools_version: Optional[str] = Field(None, max_length=50)
    vm_datastore: Optional[str] = Field(None, max_length=255)
    vm_folder: Optional[str] = Field(None, max_length=255)
    vm_uuid: Optional[str] = Field(None, max_length=64)
    vm_cpu_reserved_mhz: Optional[int] = None
    vm_memory_reserved_mb: Optional[int] = None
    # Backup (Veeam)
    backup_job_name: Optional[str] = Field(None, max_length=200)
    backup_cloud_job_name: Optional[str] = Field(None, max_length=200)
    backup_last_status: Optional[str] = Field(None, max_length=20)
    backup_restore_points: Optional[int] = None
    # EDR (Agente EDR)
    edr_endpoint_id: Optional[str] = Field(None, max_length=100)
    edr_health: Optional[str] = Field(None, max_length=20)
    edr_last_seen: Optional[datetime] = None
    edr_tamper_protected: Optional[bool] = None
    edr_online: Optional[bool] = None
    edr_agent_mode: Optional[str] = Field(None, max_length=50)
    edr_managed: Optional[bool] = None
    detected_services: Optional[dict] = None
    # Web server
    web_server_software: Optional[str] = Field(None, max_length=50)
    web_server_version: Optional[str] = Field(None, max_length=50)
    web_server_port: Optional[int] = None
    web_listen_ips: Optional[list] = None
    web_virtual_hosts: Optional[list] = None
    web_ssl_enabled: Optional[bool] = None
    web_ssl_cert_cn:     Optional[str]      = Field(None, max_length=255)
    web_ssl_cert_expiry: Optional[datetime] = None
    web_ssl_cert_issuer: Optional[str]      = Field(None, max_length=255)
    web_ssl_cert_san:    Optional[list]     = None
    web_ssl_cert_path:   Optional[str]      = Field(None, max_length=500)
    web_config_path: Optional[str] = Field(None, max_length=255)
    # Relaciones CMDB (service assets)
    host_asset_id: Optional[str] = None
    host_asset_name: Optional[str] = Field(None, max_length=255)
    db_host_asset_id: Optional[str] = None
    db_host_display: Optional[str] = Field(None, max_length=255)

def _enrich(assets: List[Asset], db: Session) -> List[dict]:
    if not assets: return []
    ids = [a.id for a in assets]
    now = datetime.now(timezone.utc)
    # Load ALL active exceptions (including where indicator is OK) for quadristate
    excs = db.query(ComplianceException).filter(
        ComplianceException.asset_id.in_(ids), ComplianceException.revoked_at == None).all()  
    exc_map: dict = {}
    for e in excs:
        if e.expires_at is None or e.expires_at > now:
            exc_map.setdefault(e.asset_id, {})[e.indicator] = e
    results = []
    for asset in assets:
        d = asset.to_dict(include_exceptions=False)
        d["exceptions"] = [{"id": e.id, "indicator": e.indicator, "reason": e.reason,
            "reason_code": str(e.reason_code).split(".")[-1] if e.reason_code else None,
            "created_by_name": e.created_by_name,
            "created_at": e.created_at.isoformat() if e.created_at else None,
            "expires_at": e.expires_at.isoformat() if e.expires_at else None}
            for e in exc_map.get(asset.id, {}).values()]
        results.append(d)
    return results

@router.get("")
def list_assets(
    as_of: Optional[datetime] = Query(None),
    type: Optional[AssetType] = None,
    search: Optional[str] = Query(None, max_length=200),
    tag_ids: Optional[str] = Query(None), data_source_id: Optional[str] = None,
    edr_installed: Optional[bool] = None, monitored: Optional[bool] = None,
    edr_online: Optional[bool] = Query(None),
    edr_tamper_protected: Optional[bool] = Query(None),
    edr_agent_mode: Optional[str] = Query(None, max_length=50),
    edr_mode_missing: Optional[bool] = Query(None),  # True = edr_installed=True y edr_agent_mode IS NULL
    edr_managed: Optional[bool] = Query(None),
    edr_health: Optional[str] = Query(None, max_length=20),  # good/suspicious/bad/unknown/sin_edr
    source: Optional[str] = Query(None),                 # filtrar por fuente exacta (vmware, edr-agent, veeam…)
    vm_power_state: Optional[str] = Query(None),         # poweredOn|poweredOff|suspended
    compliance_indicator: Optional[str] = Query(None),   # edr|mon|siem|logs|bck|bckcl
    compliance_status: Optional[str] = Query(None),      # ok|ko|ok_with_exception|ko_with_exception
    eol_tag: Optional[str] = Query(None),                # EOL KO|EOL WARN|EOL OK
    needs_review: Optional[bool] = Query(None),          # True = solo zona de revisión
    page: int = Query(1, ge=1), page_size: int = Query(50, ge=1, le=500),
    sort_by: Optional[str] = Query("name"),
    sort_order: Optional[str] = Query("asc", pattern="^(asc|desc)$"),
    db: Session = Depends(get_db), user: dict = Depends(require_viewer),
):
    if as_of:
        snapshots = history_service.get_assets_at(db, as_of)
        return {"data": snapshots, "total": len(snapshots), "as_of": as_of.isoformat(), "live": False}
    if sort_by not in SORT_FIELDS: sort_by = "name"
    if needs_review is True:
        q = db.query(Asset).filter(Asset.needs_review == True)  
    else:
        q = db.query(Asset).filter(or_(Asset.needs_review == None, Asset.needs_review == False))  
    if type: q = q.filter(Asset.type == (type.value if hasattr(type, "value") else type))
    if edr_installed is not None: q = q.filter(Asset.edr_installed == edr_installed)
    if monitored is not None: q = q.filter(Asset.monitored == monitored)
    if edr_online is not None: q = q.filter(Asset.edr_online == edr_online)
    if edr_tamper_protected is not None: q = q.filter(Asset.edr_tamper_protected == edr_tamper_protected)
    if edr_agent_mode: q = q.filter(Asset.edr_agent_mode == edr_agent_mode)
    if edr_mode_missing is True: q = q.filter(Asset.edr_installed == True, Asset.edr_agent_mode == None)  
    if edr_managed is not None: q = q.filter(Asset.edr_managed == edr_managed)
    if edr_health:
        if edr_health == "sin_edr":
            q = q.filter(Asset.edr_endpoint_id == None)  
        else:
            q = q.filter(Asset.edr_health == edr_health)
    if data_source_id: q = q.filter(Asset.data_source_id == data_source_id)
    if source: q = q.filter(Asset.source == source)
    if vm_power_state: q = q.filter(Asset.vm_power_state == vm_power_state)
    if tag_ids:
        for tid in [x.strip() for x in tag_ids.split(',') if x.strip()]:
            q = q.filter(Asset.tags.any(Tag.id == tid))
    # EOL tag filter — filtra por etiqueta de sistema EOL KO/WARN/OK
    if eol_tag:
        q = q.filter(Asset.tags.any(Tag.name == eol_tag))

    # Compliance filter — filtra por estado de indicador de compliance
    if compliance_indicator and compliance_status:
        from app.models.exception import ComplianceException
        # Obtener mapa de excepciones activas
        exc_set = set(
            f"{e.asset_id}:{str(e.indicator).split('.')[-1]}"
            for e in db.query(ComplianceException).all() if e.is_active
        )
        # Determinar qué assets cumplen el filtro de compliance
        ok_field_map = {
            "edr": "edr_installed", "mon": "monitored", "siem": "siem_enabled",
            "logs": "logs_enabled", "bck": "last_backup_local", "bckcl": "last_backup_cloud",
        }
        field = ok_field_map.get(compliance_indicator)
        if field:
            all_assets_ids = [a.id for a in q.all()]
            def _state(asset_id, is_ok_val):
                has_exc = f"{asset_id}:{compliance_indicator}" in exc_set
                if is_ok_val and has_exc: return "ok_with_exception"
                if is_ok_val: return "ok"
                if has_exc: return "ko_with_exception"
                return "ko"
            # Filtrar en memoria los que coinciden con compliance_status
            matching_ids = []
            for a in q.all():
                field_val = getattr(a, field, None)
                is_ok = bool(field_val)
                if _state(a.id, is_ok) == compliance_status:
                    matching_ids.append(a.id)
            q = db.query(Asset).filter(Asset.id.in_(matching_ids))
            # Reaplicar otros filtros que se perdieron
            if type: q = q.filter(Asset.type == (type.value if hasattr(type, "value") else type))
            if data_source_id: q = q.filter(Asset.data_source_id == data_source_id)
            if tag_ids:
                for tid in [x.strip() for x in tag_ids.split(',') if x.strip()]:
                    q = q.filter(Asset.tags.any(Tag.id == tid))

    if search:
        t = f"%{search}%"
        q = q.filter(or_(
            Asset.name.ilike(t), Asset.vendor.ilike(t), Asset.source.ilike(t),
            Asset.os.ilike(t), Asset.model.ilike(t), Asset.serial_number.ilike(t),
            Asset.location.ilike(t), Asset.description.ilike(t),
            Asset.firmware_version.ilike(t), Asset.mac_address.ilike(t),
            Asset.db_engine.ilike(t), Asset.db_host.ilike(t), Asset.db_version.ilike(t),
            cast(Asset.ips, String).ilike(t), Asset.tags.any(Tag.name.ilike(t)),
        ))
    # NULLS = sin backup = fecha mínima (la peor).
    # ASC:  null primero  — los más antiguos/peores delante
    # DESC: null último   — los más recientes delante, sin backup al final
    col = getattr(Asset, sort_by, Asset.name)
    if sort_by in ("last_backup_local","last_backup_cloud","last_sync"):
        order = nullslast(col.desc()) if sort_order == "desc" else nullsfirst(col.asc())
        # Con desc: más reciente primero, sin backup al final
        # Con asc: más antiguo primero, sin backup al final
    elif sort_by in ("name","vendor","source","type"):
        # Case-insensitive alphabetical sort
        order = func.lower(col).desc() if sort_order == "desc" else func.lower(col).asc()
    else:
        order = col.desc() if sort_order == "desc" else col.asc()
    q = q.order_by(order)
    total  = q.count()
    assets = q.offset((page-1)*page_size).limit(page_size).all()
    return {"data": _enrich(assets, db), "total": total, "page": page, "page_size": page_size, "live": True}

@router.get("/history/snapshots")
def list_snapshots(db: Session = Depends(get_db), user: dict = Depends(require_viewer)):
    return {"snapshots": history_service.get_available_snapshots(db)}

@router.get("/{asset_id}")
def get_asset(asset_id: str, db: Session = Depends(get_db), user: dict = Depends(require_viewer)):
    asset = db.query(Asset).filter_by(id=asset_id).first()
    if not asset: raise HTTPException(404, "Asset not found")
    d = _enrich([asset], db)[0]
    d.update(asset.to_dict(include_exceptions=False, detail=True))
    d["exceptions"] = _enrich([asset], db)[0]["exceptions"]
    all_excs = db.query(ComplianceException).filter_by(asset_id=asset_id).order_by(ComplianceException.created_at.desc()).all()
    d["all_exceptions"] = [e.to_dict() for e in all_excs]
    recent = db.query(AuditLog).filter_by(entity_id=asset_id).order_by(AuditLog.timestamp.desc()).limit(10).all()
    d["recent_audit"] = [{"id":l.id,"timestamp":l.timestamp.isoformat() if l.timestamp else None,
        "username":l.username,"activity_type":l.activity_type,"changes":l.changes} for l in recent]
    return d

@router.get("/{asset_id}/changelog")
def get_changelog(
    asset_id: str,
    field: Optional[str] = Query(None),
    from_dt: Optional[datetime] = Query(None, alias="from"),
    to_dt: Optional[datetime] = Query(None, alias="to"),
    limit: int = Query(200, ge=1, le=1000),
    db: Session = Depends(get_db), user: dict = Depends(require_viewer),
):
    asset = db.query(Asset).filter_by(id=asset_id).first()
    if not asset:
        raise HTTPException(404, "Asset not found")
    rows = acl_svc.get_asset_changelog(db, asset_id, field=field,
                                        from_dt=from_dt, to_dt=to_dt, limit=limit)
    return {
        "asset_id": asset_id,
        "asset_name": asset.name,
        "total": len(rows),
        "data": [
            {
                "id": r.id,
                "field": r.field,
                "old_value": r.old_value,
                "new_value": r.new_value,
                "changed_at": r.changed_at.isoformat() if r.changed_at else None,
                "source": r.source,
            }
            for r in rows
        ],
    }

@router.post("/bulk-tags")
def bulk_assign_tags(request: Request, body: BulkTagsRequest,
                     db: Session = Depends(get_db), user: dict = Depends(require_editor)):
    from app.models.tag import TagOrigin
    tags = db.query(Tag).filter(Tag.id.in_(body.tag_ids)).all()
    if len(tags) != len(body.tag_ids): raise HTTPException(404, "One or more tag IDs not found")
    if any(t.origin == TagOrigin.system for t in tags): raise HTTPException(400, "Cannot bulk-assign system tags")
    assets = db.query(Asset).filter(Asset.id.in_(body.asset_ids)).all()
    if len(assets) != len(body.asset_ids): raise HTTPException(404, "One or more asset IDs not found")
    for asset in assets:
        before = asset.to_dict(include_exceptions=False)
        existing = {t.id for t in asset.tags}
        for tag in tags:
            if tag.id not in existing: asset.tags.append(tag)
        audit_service.record(db, ActivityType.TAG_ASSIGN, user=user, entity_type="asset",
            entity_id=asset.id, entity_name=asset.name, before=before,
            after=asset.to_dict(include_exceptions=False),
            ip_address=request.client.host if request.client else None)
    db.commit()
    return {"assigned_to": len(assets), "tags_applied": [t.name for t in tags]}

@router.post("/bulk-untag")
def bulk_remove_tags(request: Request, body: BulkTagsRequest,
                     db: Session = Depends(get_db), user: dict = Depends(require_editor)):
    """Elimina la asociación de etiquetas en los assets indicados."""
    from app.models.tag import TagOrigin
    tags = db.query(Tag).filter(Tag.id.in_(body.tag_ids)).all()
    if len(tags) != len(body.tag_ids): raise HTTPException(404, "One or more tag IDs not found")
    if any(t.origin == TagOrigin.system for t in tags): raise HTTPException(400, "Cannot remove system tags")
    assets = db.query(Asset).filter(Asset.id.in_(body.asset_ids)).all()
    for asset in assets:
        before = asset.to_dict(include_exceptions=False)
        asset.tags = [t for t in asset.tags if t.id not in body.tag_ids]
        removed_names = [t.name for t in tags]
        audit_service.record(db, ActivityType.TAG_REMOVE, user=user, entity_type="asset",
            entity_id=asset.id, entity_name=asset.name,
            before={"tags_removed": removed_names},
            ip_address=request.client.host if request.client else None)
    db.commit()
    return {"removed_from": len(assets), "tags_removed": [t.name for t in tags]}

# Prioridad de fuentes: número menor = mayor autoridad sobre los datos
# IMPORTANTE: las claves deben coincidir con el campo `source` que cada script escribe en los assets
_SOURCE_PRIORITY = {"vmware": 10, "edr-agent": 20, "veeam": 30, "manual": 99}
# Campos cuyo valor viene exclusivamente de VMware — EDR nunca los sobreescribe
_VMWARE_OWNED = {
    "type", "vendor", "model",
    "vcenter_id", "vcenter_name", "hypervisor_id", "hypervisor_name",
    "vm_power_state", "vm_guest_os", "vm_tools_version", "vm_datastore", "vm_folder", "vm_uuid",
}
# Campos que EDR/Backup pueden AÑADIR si están vacíos pero no sobreescribir si ya tienen valor.
# NOTA: 'os' NO está aquí — EDR siempre gana en OS porque VMware reporta valores genéricos.
# 'product_name' y 'product_version' sí están: VMware siempre los rellena ("VMware Virtual Machine",
# "vmx-21"), por lo que EDR no puede sobreescribirlos; pero en servidores físicos sin VMware
# EDR sí puede establecerlos si están vacíos.
_ADDITIVE_FIELDS = {
    "cpu_count", "ram_gb", "total_disk_gb",
    "product_name", "product_version",
    "serial_number", "firmware_version",
}
# Fuentes secundarias que necesitan validación de merge
_SECONDARY_SOURCES = {"edr-agent", "veeam", "monitoring"}

def _normalize_mac(mac: "str | None") -> "str | None":
    """Normaliza MAC a formato xx:xx:xx:xx:xx:xx en minúsculas.
    Acepta formatos con :, -, sin separador, mayúsculas o minúsculas.
    """
    if not mac:
        return None
    cleaned = mac.replace(":", "").replace("-", "").replace(".", "").lower()
    if len(cleaned) == 12:
        return ":".join(cleaned[i:i+2] for i in range(0, 12, 2))
    return mac.lower()

# Sufijos de dominio conocidos en el entorno (sin punto inicial)
_KNOWN_DOMAIN_SUFFIXES = ("sistemas.local", "sistemas.org")

def _short_name(name: str) -> str:
    """Devuelve el nombre de host sin el dominio si coincide con un dominio conocido.
    'SRV-WEB-01.sistemas.local' → 'SRV-WEB-01'
    'SRV-WEB-01' → 'SRV-WEB-01' (sin cambio)
    """
    low = name.lower()
    for suf in _KNOWN_DOMAIN_SUFFIXES:
        full_suf = "." + suf
        if low.endswith(full_suf):
            return name[: len(name) - len(full_suf)]
    return name

def _name_variants(name: str) -> list:
    """Genera las variantes de nombre a probar para matching: short name, FQDN."""
    variants = [name]
    short = _short_name(name)
    if short.lower() != name.lower():
        variants.append(short)
    else:
        for suf in _KNOWN_DOMAIN_SUFFIXES:
            variants.append(f"{name}.{suf}")
    return variants

def _is_matchable_ip(ip: str) -> bool:
    """Descarta IPs que no son identificadores únicos de host: loopback, link-local,
    y gateways de redes overlay/Docker (patrón x.x.0.1 en rangos privados).
    Estas IPs aparecen en múltiples VMs y provocarían falsos positivos de identidad.
    """
    if not ip:
        return False
    try:
        import ipaddress
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return False
    if addr.is_loopback or addr.is_link_local:
        return False
    parts = ip.split(".")
    if len(parts) == 4 and parts[2] == "0" and parts[3] == "1":
        return False  # x.x.0.1 — gateway de red overlay/Docker, no es un host único
    return True

def _find_existing(db, item) -> "tuple[Asset | None, str | None]":
    """Busca activo existente: MAC → ID → nombre → IP.
    Devuelve (asset, match_by) donde match_by indica la señal usada ('mac','id','name','ip').
    Para fuentes secundarias (EDR, Veeam) se intenta MAC primero para
    que puedan matchear contra assets VMware antes de encontrar su propio
    registro previo por ID.
    En la búsqueda por nombre se prueban ambas formas (FQDN y short name)
    para cubrir casos donde EDR reporta FQDN y VMware solo el hostname.
    """
    is_secondary = (item.source or "") in _SECONDARY_SOURCES
    # Para VMware: UUID es el identificador más fiable (cambia en clones).
    # Si hay UUID y coincide → devolver directamente.
    # Si no hay match por UUID, puede ser un asset existente sin uuid aún (migración)
    # o una VM genuinamente nueva. Caemos al matching por MAC/nombre.
    if not is_secondary and item.vm_uuid:
        found = db.query(Asset).filter_by(vm_uuid=item.vm_uuid).first()
        if found: return found, "uuid"
    if is_secondary and item.mac_address:
        mac_norm = _normalize_mac(item.mac_address)
        found = db.query(Asset).filter_by(mac_address=mac_norm).first()
        if found: return found, "mac"
    if is_secondary and item.mac_addresses:
        for mac in item.mac_addresses:
            mac_norm = _normalize_mac(mac)
            if mac_norm:
                found = db.query(Asset).filter_by(mac_address=mac_norm).first()
                if found: return found, "mac"
    if item.id:
        found = db.query(Asset).filter_by(id=item.id).first()
        if found: return found, "id"
    if not is_secondary and item.mac_address:
        found = db.query(Asset).filter_by(mac_address=item.mac_address).first()
        if found:
            # Si el asset encontrado ya tiene un UUID distinto → es un clon/VM diferente
            if item.vm_uuid and found.vm_uuid and item.vm_uuid != found.vm_uuid:
                pass
            else:
                return found, "mac"
    if item.name:
        mac_norm = _normalize_mac(item.mac_address) if item.mac_address else None
        for candidate_name in _name_variants(item.name):
            found = db.query(Asset).filter(func.lower(Asset.name) == candidate_name.lower()).first()
            if found:
                # Si ambos tienen MAC y son distintas → hardware diferente, no es el mismo activo
                if mac_norm and found.mac_address and mac_norm != found.mac_address:
                    continue
                # Si el asset encontrado ya tiene un UUID distinto → VM diferente (clon/renombrado)
                if item.vm_uuid and found.vm_uuid and item.vm_uuid != found.vm_uuid:
                    continue
                return found, "name"
    # Para fuentes primarias con MAC (vmware), el matching por IP genera falsos positivos:
    # clones y VMs restauradas comparten IPs con el original. Solo usarlo para fuentes
    # secundarias (edr, veeam) que necesitan encontrar assets ya ingresados por vmware.
    if item.ips and (is_secondary or not item.mac_address):
        for ip in item.ips:
            if not _is_matchable_ip(ip):
                continue
            row = db.execute(
                text("SELECT id FROM assets WHERE ips::text LIKE :pat"),
                {"pat": f'%"{ip}"%'}
            ).first()
            if row:
                return db.query(Asset).filter_by(id=row.id).first(), "ip"
    return None, None

def _apply_source_priority(existing: "Asset", data: dict, item_source: str) -> list:
    """
    Aplica reglas de prioridad de fuente al dict de actualización.
    Devuelve lista de diferencias detectadas [{field, current, reported}].
    """
    existing_prio = _SOURCE_PRIORITY.get(existing.source or "", 50)
    new_prio = _SOURCE_PRIORITY.get(item_source or "", 50)
    if new_prio <= existing_prio:
        return []  # misma o mayor prioridad — actualizar todo sin restricciones

    diffs = []
    # Proteger siempre la identidad de fuente del activo existente
    data.pop("source", None)
    data.pop("data_source_id", None)
    # Eliminar campos que son propiedad exclusiva de VMware
    for f in _VMWARE_OWNED:
        data.pop(f, None)

    # Campos aditivos: añadir solo si el activo actual no los tiene
    for f in _ADDITIVE_FIELDS:
        incoming = data.get(f)
        current = getattr(existing, f, None)
        if incoming is not None:
            if current is not None and str(incoming) != str(current):
                diffs.append({"field": f, "current": current, "reported": incoming})
            if current is not None:
                data.pop(f)  # ya tiene valor — no sobreescribir

    # IPs: merge (unión) en lugar de reemplazo
    incoming_ips = set(data.get("ips") or [])
    existing_ips = set(existing.ips or [])
    if incoming_ips:
        only_in_source = sorted(incoming_ips - existing_ips)
        only_in_current = sorted(existing_ips - incoming_ips)
        if only_in_source or only_in_current:
            diffs.append({
                "field": "ips",
                "current": sorted(existing_ips),
                "reported": sorted(incoming_ips),
                "source_only": only_in_source,
                "current_only": only_in_current,
            })
        data["ips"] = sorted(existing_ips | incoming_ips)  # merge

    return diffs

def _cmp_val(v) -> str:
    """Normaliza un valor para comparación de cambios: enum → .value, None → ''."""
    if v is None:
        return ""
    if hasattr(v, 'value'):
        return str(v.value)
    return str(v)

def _safe_val(v):
    if v is None:
        return None
    if isinstance(v, list):
        items_str = [str(x) for x in v[:5]]
        s = ', '.join(items_str)
        return (s + ', …') if len(v) > 5 else s
    # Normalizar enums a su valor raw para que la comparación no dé falsos positivos
    # (ej: AssetType.vcenter → "vcenter", no "AssetType.vcenter")
    if hasattr(v, 'value'):
        v = v.value
    s = str(v)
    return (s[:80] + '…') if len(s) > 80 else s

@router.post("/ingest")
def ingest_assets(request: Request, items: List[IngestAssetRequest],
                  sync_run_id: Optional[str] = Query(None, description="ID único de sesión para agrupar todos los batches de un mismo DAG run en un único SyncRun"),
                  sync_label: Optional[str] = Query(None, description="Etiqueta del origen concreto (ej: hostname del vCenter)"),
                  db: Session = Depends(get_db), user: dict = Depends(require_admin)):
    from collections import defaultdict
    from app.models.sync_run import SyncRun
    now = datetime.now(timezone.utc)
    created = updated = 0
    mac_conflicts: list = []
    runs: dict = defaultdict(lambda: {"created": 0, "updated": 0, "matched": 0, "skipped": 0, "assets_created": [], "assets_updated": [], "assets_skipped": []})
    for item in items:
        # Normalizar MACs antes de buscar y almacenar
        if item.mac_address:
            item.mac_address = _normalize_mac(item.mac_address)
        if item.mac_addresses:
            item.mac_addresses = [n for n in (_normalize_mac(m) for m in item.mac_addresses if m) if n]
        existing, match_by = _find_existing(db, item)
        # mac_addresses es solo para matching — no se almacena en la BD
        data = {k:v for k,v in item.model_dump().items() if v is not None and k not in ("id", "mac_addresses")}
        data["last_sync"] = now
        if item.id and not existing:
            data["id"] = item.id

        if existing:
            _apply_source_priority(existing, data, item.source)
            # Detectar conflictos de identidad: señales que no se usaron para el match pero discrepan.
            # (ej: encontrado por MAC pero nombre diferente → posible renombre)
            identity_conflicts = []
            if match_by and match_by != "id":
                item_name_short = _short_name(item.name or "")
                ex_name_short = _short_name(existing.name or "")
                mac_norm = item.mac_address  # ya normalizada arriba
                _is_server = str(existing.type).split(".")[-1] in ("server_virtual", "server_physical")
                if match_by == "mac":
                    # Nombre: solo para servidores (vm_name vs hostname del SO)
                    if _is_server and item.name and existing.name and item_name_short.lower() != ex_name_short.lower():
                        identity_conflicts.append({"signal": "name", "stored": existing.name, "reported": item.name})
                    if item.ips and existing.ips and not (set(item.ips) & set(existing.ips)):
                        identity_conflicts.append({"signal": "ips", "stored": sorted(existing.ips), "reported": sorted(item.ips)})
                elif match_by == "name":
                    if mac_norm and existing.mac_address and mac_norm != existing.mac_address:
                        identity_conflicts.append({"signal": "mac", "stored": existing.mac_address, "reported": mac_norm})
                    if item.ips and existing.ips and not (set(item.ips) & set(existing.ips)):
                        identity_conflicts.append({"signal": "ips", "stored": sorted(existing.ips), "reported": sorted(item.ips)})
                elif match_by == "ip":
                    # Nombre: solo para servidores
                    if _is_server and item.name and existing.name and item_name_short.lower() != ex_name_short.lower():
                        identity_conflicts.append({"signal": "name", "stored": existing.name, "reported": item.name})
                    if mac_norm and existing.mac_address and mac_norm != existing.mac_address:
                        identity_conflicts.append({"signal": "mac", "stored": existing.mac_address, "reported": mac_norm})
            stored_diffs = dict(existing.source_diffs or {})
            if identity_conflicts:
                stored_diffs[item.source or "unknown"] = {
                    "last_seen": now.isoformat(), "match_by": match_by, "conflicts": identity_conflicts,
                }
            elif (item.source or "unknown") in stored_diffs:
                del stored_diffs[item.source or "unknown"]
            data["source_diffs"] = stored_diffs or None
            # Registrar fuentes secundarias que enriquecen el activo
            if item.source and item.source != (existing.source or ""):
                contrib = list(existing.contributing_sources or [])
                if item.source not in contrib:
                    contrib.append(item.source)
                data["contributing_sources"] = contrib
            # Service assets (con host_asset_id o db_host_asset_id) no van a revisión.
            # EDR-only sin match VMware → sigue en revisión.
            _has_host_ref = bool(item.host_asset_id or item.db_host_asset_id)
            if _has_host_ref:
                data["needs_review"] = False
            elif item.source in _SECONDARY_SOURCES and (existing.source or "") in _SECONDARY_SOURCES:
                data["needs_review"] = True
            else:
                data["needs_review"] = False
            before = existing.to_dict(include_exceptions=False)
            for k,v in data.items(): setattr(existing, k, v)
            tagging_service.apply_auto_tags(db, existing)
            _auto_add_eol_for_asset(db, existing)
            # Detectar campos realmente modificados (excluir metadatos de sincronización)
            _SKIP_FIELDS = {"last_sync","source_diffs","contributing_sources","needs_review","data_source_id","source"}
            changed_fields = [
                {"field": k, "old": _safe_val(before.get(k)), "new": _safe_val(v)}
                for k, v in data.items()
                if k not in _SKIP_FIELDS and _cmp_val(before.get(k)) != _cmp_val(v)
            ]
            audit_service.record(db, ActivityType.INGEST, user=user, entity_type="asset",
                entity_id=existing.id, entity_name=existing.name, before=before,
                after=existing.to_dict(include_exceptions=False),
                ip_address=request.client.host if request.client else None)
            updated += 1
            # Usar el data_source_id de quien REPORTA el cambio (item), no del owner del activo.
            # _apply_source_priority elimina data_source_id de data para no sobreescribir el owner,
            # pero el SyncRun debe registrarse contra la fuente que está haciendo la sync.
            ds_id = item.data_source_id or existing.data_source_id
            if ds_id:
                if changed_fields:
                    runs[ds_id]["updated"] += 1
                else:
                    runs[ds_id]["matched"] += 1
                runs[ds_id]["assets_updated"].append({
                    "id": existing.id, "name": existing.name,
                    "type": str(existing.type).split(".")[-1],
                    "changed_fields": changed_fields[:12],
                })
        else:
            if data.get("source") == "manual":
                name_val = data.get("name", "")
                if name_val:
                    dup = db.query(Asset).filter(func.lower(Asset.name) == name_val.lower()).first()
                    if dup:
                        raise HTTPException(status_code=409,
                            detail=f"Ya existe un activo con el nombre '{name_val}'")
                for ip in (data.get("ips") or []):
                    row = db.execute(
                        text("SELECT id, name FROM assets WHERE ips::text LIKE :pat"),
                        {"pat": f'%"{ip}"%'}
                    ).first()
                    if row:
                        raise HTTPException(status_code=409,
                            detail=f"La IP {ip} ya está registrada en el activo '{row.name}'")
                data["created_by"] = user.get("preferred_username") or user.get("sub", "unknown")
            # Marcar para revisión si viene de fuente secundaria y no hubo match.
            # Service assets (con host_asset_id o db_host_asset_id) son de confianza → no a revisión.
            _has_host_ref = bool(item.host_asset_id or item.db_host_asset_id)
            data["needs_review"] = not _has_host_ref and item.source in _SECONDARY_SOURCES
            # Pre-check MAC: si ya existe en otro activo → conflicto, no insertar (MAC debe ser única)
            if data.get("mac_address"):
                mac_holder = db.query(Asset).filter_by(mac_address=data["mac_address"]).first()
                if mac_holder:
                    conflict_entry = {
                        "name": data.get("name"),
                        "mac": data["mac_address"],
                        "conflicts_with": mac_holder.name,
                        "conflicts_with_id": mac_holder.id,
                    }
                    mac_conflicts.append(conflict_entry)
                    ds_id_skip = item.data_source_id
                    if ds_id_skip:
                        runs[ds_id_skip]["skipped"] += 1
                        runs[ds_id_skip]["assets_skipped"].append(conflict_entry)
                    logger.warning(
                        f"[ingest] MAC {data['mac_address']} ya en uso por '{mac_holder.name}' "
                        f"— '{data.get('name')}' NO insertado (revisar duplicado en origen)"
                    )
                    continue
            asset = Asset(**data); db.add(asset); db.flush()
            tagging_service.apply_auto_tags(db, asset)
            try:
                from app.scheduler import auto_sync_new_asset
                import asyncio
                asyncio.create_task(auto_sync_new_asset(
                    asset_os=asset.os, asset_db_engine=asset.db_engine,
                    asset_vendor=asset.vendor, asset_model=asset.model,
                    asset_firmware=asset.firmware_version,
                ))
            except Exception:
                pass
            audit_service.record(db, ActivityType.CREATE, user=user, entity_type="asset",
                entity_id=asset.id, entity_name=asset.name, before=None,
                after=asset.to_dict(include_exceptions=False),
                ip_address=request.client.host if request.client else None)
            _auto_add_eol_for_asset(db, asset)
            created += 1
            ds_id = data.get("data_source_id")
            if ds_id:
                runs[ds_id]["created"] += 1
                runs[ds_id]["assets_created"].append({
                    "id": asset.id, "name": asset.name,
                    "type": str(asset.type).split(".")[-1]
                })
    for ds_id, rd in runs.items():
        if rd["created"] > 0 or rd["updated"] > 0 or rd["matched"] > 0 or rd["skipped"] > 0:
            if sync_run_id:
                composed_id = f"{sync_run_id}_{ds_id}"
                existing_run = db.get(SyncRun, composed_id)
                if existing_run:
                    existing_run.created_count  += rd["created"]
                    existing_run.updated_count  += rd["updated"]
                    existing_run.matched_count   = (existing_run.matched_count or 0) + rd["matched"]
                    existing_run.skipped_count   = (existing_run.skipped_count or 0) + rd["skipped"]
                    existing_run.assets_created  = (existing_run.assets_created or []) + rd["assets_created"]
                    existing_run.assets_updated  = (existing_run.assets_updated or []) + rd["assets_updated"]
                    existing_run.assets_skipped  = (existing_run.assets_skipped or []) + rd["assets_skipped"]
                    if sync_label and not existing_run.label:
                        existing_run.label = sync_label
                else:
                    db.add(SyncRun(id=composed_id, sync_run_id=sync_run_id,
                                   data_source_id=ds_id, run_at=now,
                                   created_count=rd["created"], updated_count=rd["updated"],
                                   matched_count=rd["matched"], skipped_count=rd["skipped"],
                                   assets_created=rd["assets_created"],
                                   assets_updated=rd["assets_updated"],
                                   assets_skipped=rd["assets_skipped"],
                                   label=sync_label))
            else:
                db.add(SyncRun(data_source_id=ds_id, run_at=now,
                               created_count=rd["created"], updated_count=rd["updated"],
                               matched_count=rd["matched"], skipped_count=rd["skipped"],
                               assets_created=rd["assets_created"],
                               assets_updated=rd["assets_updated"],
                               assets_skipped=rd["assets_skipped"],
                               label=sync_label))
    db.commit()
    return {
        "created": created,
        "updated": updated,
        "skipped": len(mac_conflicts),
        "total": len(items),
        "mac_conflicts": mac_conflicts,
    }

@router.patch("/{asset_id}/notes", dependencies=[Depends(require_editor)])
def update_notes(asset_id: str, body: dict, db: Session = Depends(get_db),
                 user: dict = Depends(require_editor)):
    asset = db.query(Asset).filter(Asset.id == asset_id).first()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset no encontrado")
    asset.notes = body.get("notes") or None
    db.commit()
    return {"id": asset.id, "notes": asset.notes}

@router.delete("/{asset_id}", dependencies=[Depends(require_editor)])
def delete_asset(asset_id: str, request: Request, db: Session = Depends(get_db),
                 user: dict = Depends(require_editor)):
    asset = db.query(Asset).filter(Asset.id == asset_id).first()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset no encontrado")
    if asset.source != "manual":
        raise HTTPException(status_code=403, detail="Solo se pueden eliminar activos dados de alta manualmente")
    audit_service.record(db, ActivityType.DELETE, user=user, entity_type="asset",
        entity_id=asset.id, entity_name=asset.name,
        before=asset.to_dict(include_exceptions=False), after=None,
        ip_address=request.client.host if request.client else None)
    db.delete(asset)
    db.commit()
    return {"ok": True, "deleted": asset_id}

# Router CMDB separado (prefix /v1/cmdb)
cmdb_router = APIRouter(prefix="/v1/cmdb", tags=["CMDB"])

# Endpoints especializados por tipo CMDB

@cmdb_router.get("/servers")
def list_servers(
    server_type: Optional[str] = Query(None),  # "physical", "virtual", "vcenter"
    os: Optional[str] = Query(None),
    vm_power_state: Optional[str] = Query(None),  # "poweredOn", "poweredOff", "suspended"
    vcenter_id: Optional[str] = Query(None),
    search: Optional[str] = Query(None, max_length=200),
    page: int = Query(1, ge=1), page_size: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db), user: dict = Depends(require_viewer),
):
    """Servidores físicos, virtuales y vCenters con sus relaciones CMDB."""
    types = {
        "physical": [AssetType.server_physical],
        "virtual":  [AssetType.server_virtual],
        "vcenter":  [AssetType.vcenter],
    }
    q = db.query(Asset).filter(
        Asset.type.in_([t.value for t in (types.get(server_type) or [AssetType.server_physical, AssetType.server_virtual, AssetType.vcenter])]),
        or_(Asset.needs_review == None, Asset.needs_review == False)  
    )
    if os: q = q.filter(Asset.os.ilike(f"%{os}%"))
    if vm_power_state: q = q.filter(Asset.vm_power_state == vm_power_state)
    if vcenter_id: q = q.filter(Asset.vcenter_id == vcenter_id)
    if search:
        t = f"%{search}%"
        q = q.filter(or_(Asset.name.ilike(t), Asset.os.ilike(t), Asset.vendor.ilike(t),
                         Asset.product_name.ilike(t), Asset.serial_number.ilike(t),
                         cast(Asset.ips, String).ilike(t)))
    total = q.count()
    assets = q.order_by(Asset.name).offset((page-1)*page_size).limit(page_size).all()
    return {"data": _enrich(assets, db), "total": total, "page": page, "page_size": page_size}

@cmdb_router.get("/network")
def list_network(
    net_type: Optional[str] = Query(None),  # "switch","router","firewall","load_balancer","ap"
    vendor: Optional[str] = Query(None),
    search: Optional[str] = Query(None, max_length=200),
    page: int = Query(1, ge=1), page_size: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db), user: dict = Depends(require_viewer),
):
    """Equipos de red: switches, routers, firewalls, balanceadores, APs."""
    net_types = {
        "switch": AssetType.switch, "router": AssetType.router,
        "firewall": AssetType.firewall, "load_balancer": AssetType.load_balancer, "ap": AssetType.ap,
    }
    all_net = [AssetType.switch, AssetType.router, AssetType.firewall, AssetType.load_balancer, AssetType.ap]
    q = db.query(Asset).filter(
        Asset.type.in_([net_types[net_type].value] if net_type in net_types else [t.value for t in all_net]),
        or_(Asset.needs_review == None, Asset.needs_review == False)  
    )
    if vendor: q = q.filter(Asset.vendor.ilike(f"%{vendor}%"))
    if search:
        t = f"%{search}%"
        q = q.filter(or_(Asset.name.ilike(t), Asset.vendor.ilike(t), Asset.model.ilike(t),
                         Asset.product_name.ilike(t), Asset.serial_number.ilike(t),
                         cast(Asset.ips, String).ilike(t)))
    total = q.count()
    assets = q.order_by(Asset.type, Asset.name).offset((page-1)*page_size).limit(page_size).all()
    return {"data": _enrich(assets, db), "total": total, "page": page, "page_size": page_size}

@cmdb_router.get("/databases")
def list_databases(
    engine: Optional[str] = Query(None),
    host_asset_id: Optional[str] = Query(None),
    search: Optional[str] = Query(None, max_length=200),
    page: int = Query(1, ge=1), page_size: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db), user: dict = Depends(require_viewer),
):
    """Instancias de bases de datos con referencia al servidor host."""
    q = db.query(Asset).filter(Asset.type == AssetType.database.value, or_(Asset.needs_review == None, Asset.needs_review == False))  
    if engine: q = q.filter(Asset.db_engine.ilike(f"%{engine}%"))
    if host_asset_id: q = q.filter(Asset.db_host_asset_id == host_asset_id)
    if search:
        t = f"%{search}%"
        q = q.filter(or_(Asset.name.ilike(t), Asset.db_engine.ilike(t),
                         Asset.db_version.ilike(t), Asset.db_host.ilike(t),
                         cast(Asset.ips, String).ilike(t)))
    total = q.count()
    assets = q.order_by(Asset.db_engine, Asset.name).offset((page-1)*page_size).limit(page_size).all()
    return {"data": _enrich(assets, db), "total": total, "page": page, "page_size": page_size}

@cmdb_router.get("/web-servers")
def list_web_servers(
    software: Optional[str] = Query(None),
    host_asset_id: Optional[str] = Query(None),
    search: Optional[str] = Query(None, max_length=200),
    page: int = Query(1, ge=1), page_size: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db), user: dict = Depends(require_viewer),
):
    """Servidores web (Nginx, Apache, IIS...) con referencia al servidor host."""
    q = db.query(Asset).filter(Asset.type == AssetType.web_server.value, or_(Asset.needs_review == None, Asset.needs_review == False))  
    if software: q = q.filter(Asset.web_server_software.ilike(f"%{software}%"))
    if host_asset_id: q = q.filter(Asset.host_asset_id == host_asset_id)
    if search:
        t = f"%{search}%"
        q = q.filter(or_(Asset.name.ilike(t), Asset.web_server_software.ilike(t),
                         Asset.web_server_version.ilike(t), Asset.host_asset_name.ilike(t),
                         cast(Asset.ips, String).ilike(t)))
    total = q.count()
    assets = q.order_by(Asset.web_server_software, Asset.name).offset((page-1)*page_size).limit(page_size).all()
    return {"data": _enrich(assets, db), "total": total, "page": page, "page_size": page_size}

@cmdb_router.get("/storage")
def list_storage(
    storage_type: Optional[str] = Query(None),
    search: Optional[str] = Query(None, max_length=200),
    page: int = Query(1, ge=1), page_size: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db), user: dict = Depends(require_viewer),
):
    """Arrays de almacenamiento SAN/NAS."""
    q = db.query(Asset).filter(Asset.type == AssetType.storage_array.value, or_(Asset.needs_review == None, Asset.needs_review == False))  
    if storage_type: q = q.filter(Asset.storage_type.ilike(f"%{storage_type}%"))
    if search:
        t = f"%{search}%"
        q = q.filter(or_(Asset.name.ilike(t), Asset.vendor.ilike(t), Asset.storage_type.ilike(t),
                         cast(Asset.ips, String).ilike(t)))
    total = q.count()
    assets = q.order_by(Asset.name).offset((page-1)*page_size).limit(page_size).all()
    return {"data": _enrich(assets, db), "total": total, "page": page, "page_size": page_size}

@cmdb_router.get("/asset-relations/{asset_id}")
def asset_relations(asset_id: str, db: Session = Depends(get_db), user: dict = Depends(require_viewer)):
    """Devuelve todas las relaciones CMDB de un asset: VMs hosted, DBs, web servers, etc."""
    asset = db.query(Asset).filter_by(id=asset_id).first()
    if not asset: raise HTTPException(404, "Asset not found")
    result = {"asset_id": asset_id, "name": asset.name, "type": str(asset.type).split(".")[-1]}

    # VMs en este vCenter
    if asset.type == AssetType.vcenter:
        vms = db.query(Asset).filter(Asset.vcenter_id == asset_id).all()
        result["hosted_vms"] = [{"id": v.id, "name": v.name, "os": v.os,
                                  "hypervisor_name": v.hypervisor_name} for v in vms]

    # VMs en este host físico
    if asset.type == AssetType.server_physical:
        vms = db.query(Asset).filter(Asset.hypervisor_id == asset_id).all()
        result["hosted_vms"] = [{"id": v.id, "name": v.name, "os": v.os,
                                  "vcenter_name": v.vcenter_name} for v in vms]
        # DBs en este host
        dbs = db.query(Asset).filter(Asset.db_host_asset_id == asset_id).all()
        result["databases"] = [{"id": d.id, "name": d.name, "engine": d.db_engine,
                                  "version": d.db_version} for d in dbs]
        # Web servers en este host
        webs = db.query(Asset).filter(
            Asset.host_asset_id == asset_id,
            Asset.type == AssetType.web_server.value,
        ).all()
        result["web_servers"] = [{"id": w.id, "name": w.name, "software": w.web_server_software,
                                   "version": w.web_server_version} for w in webs]
        # Containers en este host
        ctrs = db.query(Asset).filter(
            Asset.host_asset_id == asset_id,
            Asset.type == AssetType.container.value,
        ).all()
        result["containers"] = [{"id": c.id, "name": c.name, "image": c.container_image,
                                  "status": c.container_status,
                                  "compose_project": c.container_compose_project,
                                  "compose_service": c.container_compose_service} for c in ctrs]

    # Para VMs también
    if asset.type == AssetType.server_virtual:
        dbs = db.query(Asset).filter(Asset.db_host_asset_id == asset_id).all()
        result["databases"] = [{"id": d.id, "name": d.name, "engine": d.db_engine,
                                  "version": d.db_version} for d in dbs]
        webs = db.query(Asset).filter(
            Asset.host_asset_id == asset_id,
            Asset.type == AssetType.web_server.value,
        ).all()
        result["web_servers"] = [{"id": w.id, "name": w.name, "software": w.web_server_software} for w in webs]
        ctrs = db.query(Asset).filter(
            Asset.host_asset_id == asset_id,
            Asset.type == AssetType.container.value,
        ).all()
        result["containers"] = [{"id": c.id, "name": c.name, "image": c.container_image,
                                  "status": c.container_status,
                                  "compose_project": c.container_compose_project,
                                  "compose_service": c.container_compose_service} for c in ctrs]

    # Para DB: su servidor host
    if asset.type == AssetType.database and asset.db_host_asset_id:
        host = db.query(Asset).filter_by(id=asset.db_host_asset_id).first()
        if host: result["host"] = {"id": host.id, "name": host.name,
                                    "type": str(host.type).split(".")[-1], "ips": host.ips}

    # Para web_server: su servidor host
    if asset.type == AssetType.web_server and asset.host_asset_id:
        host = db.query(Asset).filter_by(id=asset.host_asset_id).first()
        if host: result["host"] = {"id": host.id, "name": host.name,
                                    "type": str(host.type).split(".")[-1], "ips": host.ips}

    # Para container: su servidor host
    if asset.type == AssetType.container and asset.host_asset_id:
        host = db.query(Asset).filter_by(id=asset.host_asset_id).first()
        if host: result["host"] = {"id": host.id, "name": host.name,
                                    "type": str(host.type).split(".")[-1], "ips": host.ips}

    # Para k8s_cluster: nodos que componen el cluster
    if asset.type == AssetType.k8s_cluster:
        nodes = asset.k8s_nodes or []
        result["k8s_nodes"] = nodes
        # Buscar los server assets de los nodos si tienen hostname/IP conocida
        node_names = [n.get("hostname") for n in nodes if n.get("hostname")]
        if node_names:
            from sqlalchemy import func
            server_assets = db.query(Asset).filter(
                Asset.name.in_(node_names),
                Asset.type.in_([AssetType.server_physical.value, AssetType.server_virtual.value]),
            ).all()
            result["node_assets"] = [{"id": s.id, "name": s.name, "ips": s.ips,
                                       "os": s.os} for s in server_assets]

    return result

@cmdb_router.get("/kubernetes")
def list_kubernetes(
    provider: Optional[str] = Query(None),   # k3s, kubeadm, eks, gke, aks, rke2
    k8s_version: Optional[str] = Query(None),
    search: Optional[str] = Query(None, max_length=200),
    page: int = Query(1, ge=1), page_size: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db), user: dict = Depends(require_viewer),
):
    """Clusters Kubernetes con sus nodos, pods y despliegues."""
    q = db.query(Asset).filter(Asset.type == AssetType.k8s_cluster.value,
                               or_(Asset.needs_review == None, Asset.needs_review == False))  
    if provider:
        q = q.filter(Asset.k8s_provider.ilike(f"%{provider}%"))
    if k8s_version:
        q = q.filter(Asset.k8s_version.ilike(f"%{k8s_version}%"))
    if search:
        t = f"%{search}%"
        q = q.filter(or_(Asset.name.ilike(t), Asset.k8s_provider.ilike(t),
                         Asset.k8s_version.ilike(t), Asset.k8s_network_plugin.ilike(t),
                         cast(Asset.ips, String).ilike(t)))
    total = q.count()
    assets = q.order_by(Asset.name).offset((page-1)*page_size).limit(page_size).all()
    return {"data": _enrich(assets, db), "total": total, "page": page, "page_size": page_size}

@cmdb_router.get("/containers")
def list_containers(
    runtime: Optional[str] = Query(None),   # docker, containerd, podman
    status: Optional[str] = Query(None),    # running, stopped, exited, paused
    host_asset_id: Optional[str] = Query(None),
    search: Optional[str] = Query(None, max_length=200),
    page: int = Query(1, ge=1), page_size: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db), user: dict = Depends(require_viewer),
):
    """Contenedores Docker/OCI con referencia al servidor host."""
    q = db.query(Asset).filter(Asset.type == AssetType.container.value,
                               or_(Asset.needs_review == None, Asset.needs_review == False))  
    if runtime:
        q = q.filter(Asset.container_runtime.ilike(f"%{runtime}%"))
    if status:
        q = q.filter(Asset.container_status == status)
    if host_asset_id:
        q = q.filter(Asset.host_asset_id == host_asset_id)
    if search:
        t = f"%{search}%"
        q = q.filter(or_(Asset.name.ilike(t), Asset.container_image.ilike(t),
                         Asset.container_image_tag.ilike(t), Asset.container_compose_project.ilike(t),
                         cast(Asset.ips, String).ilike(t)))
    total = q.count()
    assets = q.order_by(Asset.container_status, Asset.name).offset((page-1)*page_size).limit(page_size).all()
    return {"data": _enrich(assets, db), "total": total, "page": page, "page_size": page_size}
