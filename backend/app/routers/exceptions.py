from app.services.db_utils import db_op
import logging
from datetime import datetime, timezone
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field, validator
from sqlalchemy.orm import Session
from app.database import get_db
from app.middleware.auth import require_admin, require_viewer
from app.models.asset import Asset
from app.models.exception import ComplianceException, ComplianceIndicator, ExceptionReasonCode, REASON_LABELS
from app.models.audit import ActivityType
from app.services import audit_service

logger = logging.getLogger("tfg.exceptions")
router = APIRouter(prefix="/v1/exceptions", tags=["Compliance Exceptions"])

class ExceptionCreate(BaseModel):
    asset_ids:   List[str] = Field(..., min_items=1)
    indicator:   ComplianceIndicator
    reason_code: ExceptionReasonCode
    description: str = Field(..., min_length=20, max_length=2000)
    expires_at:  Optional[datetime] = None

    @validator("description")
    def desc_not_trivial(cls, v):
        if len(v.strip()) < 20:
            raise ValueError("description must be at least 20 characters")
        return v.strip()

def _build_reason(reason_code: str, description: str) -> str:
    label = REASON_LABELS.get(reason_code, reason_code)
    return f"{label}: {description}"

def _to_dict(e: ComplianceException) -> dict:
    return {"id": e.id, "asset_id": e.asset_id,
            "asset_name": e.asset.name if e.asset else None,
            "indicator": e.indicator, "reason_code": e.reason_code,
            "reason": e.reason, "created_by": e.created_by,
            "created_by_name": e.created_by_name,
            "created_at": e.created_at.isoformat() if e.created_at else None,
            "expires_at": e.expires_at.isoformat() if e.expires_at else None,
            "revoked_by": e.revoked_by, "revoked_by_name": e.revoked_by_name,
            "revoked_at": e.revoked_at.isoformat() if e.revoked_at else None,
            "status": e.status}

@router.get("")
def list_exceptions(
    asset_id:  Optional[str] = None,
    indicator: Optional[ComplianceIndicator] = None,
    status:    Optional[str] = Query("active", pattern="^(active|revoked|expired|all)$"),
    page:      int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=500),
    db: Session = Depends(get_db), user: dict = Depends(require_viewer),
):
    now = datetime.now(timezone.utc)
    q = db.query(ComplianceException)
    if asset_id:  q = q.filter(ComplianceException.asset_id == asset_id)
    if indicator: q = q.filter(ComplianceException.indicator == indicator)
    if status == "active":
        q = q.filter(ComplianceException.revoked_at == None).filter(  
            (ComplianceException.expires_at == None) | (ComplianceException.expires_at > now))  
    elif status == "revoked":
        q = q.filter(ComplianceException.revoked_at != None)  
    elif status == "expired":
        q = q.filter(ComplianceException.revoked_at == None,  
                     ComplianceException.expires_at != None,  
                     ComplianceException.expires_at <= now)
    q = q.order_by(ComplianceException.created_at.desc())
    total = q.count()
    items = q.offset((page-1)*page_size).limit(page_size).all()
    return {"data": [_to_dict(e) for e in items], "total": total, "page": page, "page_size": page_size}

@router.get("/{exc_id}")
def get_exception(exc_id: str, db: Session = Depends(get_db), user: dict = Depends(require_viewer)):
    exc = db.query(ComplianceException).filter_by(id=exc_id).first()
    if not exc: raise HTTPException(404, "Exception not found")
    return _to_dict(exc)

@router.post("", status_code=201)
def create_exception(request: Request, body: ExceptionCreate,
                     db: Session = Depends(get_db), user: dict = Depends(require_admin)):
    now    = datetime.now(timezone.utc)
    reason = _build_reason(body.reason_code, body.description)
    created = []; skipped = []
    for asset_id in body.asset_ids:
        asset = db.query(Asset).filter_by(id=asset_id).first()
        if not asset: raise HTTPException(404, f"Asset {asset_id} not found")
        existing = (db.query(ComplianceException)
            .filter(ComplianceException.asset_id == asset_id,
                    ComplianceException.indicator == body.indicator,
                    ComplianceException.revoked_at == None)  
            .filter((ComplianceException.expires_at == None) | (ComplianceException.expires_at > now))  
            .first())
        if existing: skipped.append(asset_id); continue
        exc = ComplianceException(asset_id=asset_id, indicator=body.indicator,
                                  reason_code=body.reason_code, reason=reason,
                                  created_by=user.get("sub",""), created_by_name=user.get("preferred_username",""),
                                  expires_at=body.expires_at)
        db.add(exc); db.flush()
        audit_service.record(db, ActivityType.CREATE, user=user, entity_type="exception",
            entity_id=exc.id, entity_name=f"{asset.name}/{exc.indicator}",
            after=_to_dict(exc), ip_address=request.client.host if request.client else None)
        created.append(_to_dict(exc))
    db.commit()
    return {"created": len(created), "skipped": len(skipped), "exceptions": created}

@router.delete("/{exc_id}")
def revoke_exception(request: Request, exc_id: str,
                     db: Session = Depends(get_db), user: dict = Depends(require_admin)):
    exc = db.query(ComplianceException).filter_by(id=exc_id).first()
    if not exc: raise HTTPException(404, "Exception not found")
    if exc.revoked_at is not None: raise HTTPException(409, "Exception already revoked")
    before = _to_dict(exc)
    exc.revoked_by = user.get("sub",""); exc.revoked_by_name = user.get("preferred_username","")
    exc.revoked_at = datetime.now(timezone.utc)
    audit_service.record(db, ActivityType.EXCEPTION_REVOKE, user=user, entity_type="exception",
        entity_id=exc.id, entity_name=f"{exc.asset.name if exc.asset else exc.asset_id}/{exc.indicator}",
        before=before, after=_to_dict(exc), ip_address=request.client.host if request.client else None)
    db.commit(); db.refresh(exc)
    return _to_dict(exc)

@router.get("/reason-codes/list", summary="List available reason codes")
def list_reason_codes(user: dict = Depends(require_viewer)):
    return [{"code": k, "label": v} for k, v in REASON_LABELS.items()]
