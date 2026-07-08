import logging
from app.services.db_utils import db_op
from datetime import datetime, timezone
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import func, text
from sqlalchemy.orm import Session
from app.database import get_db
from app.middleware.auth import require_admin, require_viewer
from app.models.data_source import DataSource, DataSourceType, DataSourceStatus
from app.services import audit_service
from app.models.audit import ActivityType

logger = logging.getLogger("tfg.data_sources")
router = APIRouter(prefix="/v1/data-sources", tags=["Data Sources"])

class DSCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    type: DataSourceType
    description: Optional[str] = Field(None, max_length=500)
    connection_config: Optional[dict] = None
    is_active: bool = True
    sync_interval_minutes: int = Field(60, ge=1)
    priority: int = Field(100, ge=1)

class DSUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    description: Optional[str] = None
    connection_config: Optional[dict] = None
    is_active: Optional[bool] = None
    sync_interval_minutes: Optional[int] = Field(None, ge=1)
    priority: Optional[int] = Field(None, ge=1)

def _d(ds, last_run=None):
    d = {"id": ds.id, "name": ds.name, "type": ds.type, "description": ds.description,
         "is_active": ds.is_active, "status": ds.status,
         "last_sync": ds.last_sync.isoformat() if ds.last_sync else None,
         "sync_interval_minutes": ds.sync_interval_minutes, "priority": ds.priority,
         "created_at": ds.created_at.isoformat() if ds.created_at else None,
         "asset_count": len(ds.assets),
         "last_run_created": None, "last_run_updated": None, "last_run_skipped": None}
    if last_run:
        d["last_run_created"] = last_run.created_count or 0
        d["last_run_updated"] = last_run.updated_count or 0
        d["last_run_skipped"] = last_run.skipped_count or 0
    return d

@router.get("")
def list_ds(db: Session = Depends(get_db), user=Depends(require_viewer)):
    from app.models.sync_run import SyncRun
    sources = db.query(DataSource).order_by(DataSource.priority).all()
    result = []
    for ds in sources:
        last_run = (db.query(SyncRun)
                    .filter_by(data_source_id=ds.id)
                    .order_by(SyncRun.run_at.desc())
                    .first())
        result.append(_d(ds, last_run))
    return result

@router.get("/{sid}")
def get_ds(sid: str, db: Session = Depends(get_db), user=Depends(require_viewer)):
    ds = db.query(DataSource).filter_by(id=sid).first()
    if not ds: raise HTTPException(404, "Not found")
    return _d(ds)

@router.post("", status_code=201)
def create_ds(request: Request, body: DSCreate, db: Session = Depends(get_db), user=Depends(require_admin)):
    if db.query(DataSource).filter_by(name=body.name).first():
        raise HTTPException(409, f"Data source '{body.name}' already exists")
    ds = DataSource(**body.model_dump())
    db.add(ds); db.flush()
    audit_service.record(db, ActivityType.CREATE, user=user, entity_type="data_source",
        entity_id=ds.id, entity_name=ds.name, after=_d(ds),
        ip_address=request.client.host if request.client else None)
    db.commit(); db.refresh(ds)
    return _d(ds)

@router.put("/{sid}")
def update_ds(request: Request, sid: str, body: DSUpdate, db: Session = Depends(get_db), user=Depends(require_admin)):
    ds = db.query(DataSource).filter_by(id=sid).first()
    if not ds: raise HTTPException(404, "Not found")
    before = _d(ds)
    for k, v in body.dict(exclude_none=True).items(): setattr(ds, k, v)
    audit_service.record(db, ActivityType.UPDATE, user=user, entity_type="data_source",
        entity_id=ds.id, entity_name=ds.name, before=before, after=_d(ds),
        ip_address=request.client.host if request.client else None)
    db.commit(); db.refresh(ds)
    return _d(ds)

@router.delete("/{sid}", status_code=204)
def delete_ds(request: Request, sid: str, db: Session = Depends(get_db), user=Depends(require_admin)):
    ds = db.query(DataSource).filter_by(id=sid).first()
    if not ds: raise HTTPException(404, "Not found")
    audit_service.record(db, ActivityType.DELETE, user=user, entity_type="data_source",
        entity_id=ds.id, entity_name=ds.name, before=_d(ds),
        ip_address=request.client.host if request.client else None)
    db.delete(ds); db.commit()

@router.get("/{sid}/pending")
def get_pending(sid: str, db: Session = Depends(get_db), user=Depends(require_viewer)):
    """Assets de esta fuente que no pudieron machear con activos existentes."""
    from app.models.asset import Asset
    ds = db.query(DataSource).filter_by(id=sid).first()
    if not ds: raise HTTPException(404, "Not found")
    pending = db.query(Asset).filter(Asset.data_source_id == sid, Asset.needs_review == True).all()
    result = []
    for a in pending:
        # Sugerencias por nombre similar
        suggestions = []
        if a.name:
            name_matches = db.query(Asset).filter(
                Asset.id != a.id, Asset.needs_review == False,
                func.lower(Asset.name).contains(a.name[:6].lower())
            ).limit(3).all()
            for m in name_matches:
                suggestions.append({"id": m.id, "name": m.name, "type": str(m.type).split(".")[-1],
                    "source": m.source, "reason": "nombre similar"})
        # Sugerencias por IP compartida
        for ip in (a.ips or [])[:3]:
            row = db.execute(
                text("SELECT id, name, type, source FROM assets WHERE id != :aid AND (needs_review IS NULL OR needs_review = false) AND ips::text LIKE :pat LIMIT 1"),
                {"aid": a.id, "pat": f'%"{ip}"%'}
            ).first()
            if row and not any(s["id"] == row.id for s in suggestions):
                suggestions.append({"id": row.id, "name": row.name, "type": str(row.type).split(".")[-1],
                    "source": row.source, "reason": f"IP compartida: {ip}"})
        result.append({"id": a.id, "name": a.name, "type": str(a.type).split(".")[-1],
            "source": a.source, "ips": a.ips, "mac_address": a.mac_address, "os": a.os,
            "last_sync": a.last_sync.isoformat() if a.last_sync else None,
            "suggestions": suggestions})
    return {"count": len(result), "items": result}

@router.post("/{sid}/pending/{asset_id}/dismiss")
def dismiss_pending(sid: str, asset_id: str, db: Session = Depends(get_db), user=Depends(require_admin)):
    """Marca un activo pendiente como revisado (confirmar que es un activo nuevo, no duplicado)."""
    from app.models.asset import Asset
    a = db.query(Asset).filter_by(id=asset_id).first()
    if not a: raise HTTPException(404, "Asset no encontrado")
    a.needs_review = False
    db.commit()
    return {"ok": True}

@router.get("/{sid}/diffs")
def get_diffs(sid: str, db: Session = Depends(get_db), user=Depends(require_viewer)):
    """Assets con conflictos de identidad detectados por esta fuente."""
    from app.models.asset import Asset
    ds = db.query(DataSource).filter_by(id=sid).first()
    if not ds: raise HTTPException(404, "Not found")
    
    assets_with_diffs = db.query(Asset).filter(Asset.source_diffs != None).all()  
    result = []
    for a in assets_with_diffs:
        sd = a.source_diffs or {}
        for key, diff_data in sd.items():
            if ds.type not in key and key not in (ds.name or "").lower():
                continue
            # Soportar nuevo formato (conflicts) y formato antiguo (diffs) por compatibilidad
            raw = diff_data.get("conflicts") or diff_data.get("diffs", [])
            if not raw:
                continue
            diffs_out = []
            for c in raw:
                if "signal" in c:
                    # Nuevo formato: conflicto de identidad
                    diffs_out.append({
                        "field": c["signal"],
                        "current": c.get("stored"),
                        "reported": c.get("reported"),
                    })
                else:
                    diffs_out.append(c)
            result.append({
                "asset_id": a.id, "asset_name": a.name,
                "asset_source": a.source, "asset_type": str(a.type).split(".")[-1],
                "reporting_source": key,
                "last_seen": diff_data.get("last_seen"),
                "match_by": diff_data.get("match_by"),
                "diffs": diffs_out,
            })
    return {"count": len(result), "items": result}

@router.get("/{sid}/runs")
def get_runs(sid: str, db: Session = Depends(get_db), user=Depends(require_viewer)):
    from app.models.sync_run import SyncRun
    ds = db.query(DataSource).filter_by(id=sid).first()
    if not ds: raise HTTPException(404, "Not found")
    runs = db.query(SyncRun).filter_by(data_source_id=sid).order_by(SyncRun.run_at.desc()).limit(50).all()
    return {"count": len(runs), "items": [
        {"id": r.id, "run_at": r.run_at.isoformat(),
         "created_count": r.created_count, "updated_count": r.updated_count,
         "matched_count": r.matched_count or 0,
         "label": r.label}
        for r in runs
    ]}

@router.get("/{sid}/runs/{run_id}")
def get_run_detail(sid: str, run_id: str, db: Session = Depends(get_db), user=Depends(require_viewer)):
    from app.models.sync_run import SyncRun
    r = db.query(SyncRun).filter_by(id=run_id, data_source_id=sid).first()
    if not r: raise HTTPException(404, "Run no encontrado")
    all_updated = r.assets_updated or []
    # Separar activos con cambios reales de los que solo hicieron match sin modificaciones
    assets_updated = [a for a in all_updated if (a.get("changed_fields") or [])]
    assets_matched = [a for a in all_updated if not (a.get("changed_fields") or [])]
    return {"id": r.id, "run_at": r.run_at.isoformat(),
            "created_count": r.created_count, "updated_count": r.updated_count,
            "label": r.label,
            "assets_created": r.assets_created or [],
            "assets_updated": assets_updated,
            "assets_matched": assets_matched}

@router.post("/{sid}/validate")
def validate_ds(sid: str, db: Session = Depends(get_db), user=Depends(require_admin)):
    ds = db.query(DataSource).filter_by(id=sid).first()
    if not ds: raise HTTPException(404, "Not found")
    cfg = ds.connection_config or {}
    result = {"success": False, "message": "", "timestamp": datetime.now(timezone.utc).isoformat()}
    try:
        url = cfg.get("url", "")
        if not url:
            result["message"] = "No URL configured"
        else:
            import httpx
            r = httpx.get(url, timeout=5, follow_redirects=True)
            result["success"] = r.status_code < 500
            result["message"] = f"HTTP {r.status_code}"
    except Exception as e:
        result["message"] = f"Connection failed: {str(e)[:200]}"
    return result
