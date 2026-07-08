from app.services.db_utils import db_op
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional, List
from datetime import date, timedelta
from app.database import get_db
from app.models.audit import ActivityType
from app.services import audit_service
from app.middleware.auth import require_viewer, require_editor
from app.models.certificate import Certificate, KeyType, CAType, CertEnvironment

router = APIRouter()

class CertBody(BaseModel):
    common_name: str
    san_domains: Optional[List[str]] = []
    serial_number: Optional[str] = None
    issued_at: Optional[date] = None
    expires_at: date
    issuer: Optional[str] = None
    issuer_common_name: Optional[str] = None
    issuer_organization: Optional[str] = None
    issuer_country: Optional[str] = None
    ca_type: Optional[CAType] = CAType.unknown
    subject_organization: Optional[str] = None
    subject_organizational_unit: Optional[str] = None
    subject_country: Optional[str] = None
    subject_state: Optional[str] = None
    subject_locality: Optional[str] = None
    key_type: Optional[KeyType] = KeyType.rsa_2048
    wildcard: bool = False
    auto_renew: bool = False
    managed_by: Optional[str] = None
    environment: Optional[CertEnvironment] = CertEnvironment.production
    notes: Optional[str] = None

@router.get("/v1/certificates/expiry-summary")
def expiry_summary(db: Session = Depends(get_db), user=Depends(require_viewer)):
    certs = db.query(Certificate).all()
    result = {"total": len(certs), "valid": 0, "expiring_soon": 0, "critical": 0, "expired": 0, "next_expiry": None}
    soonest = None
    for c in certs:
        s = c.cert_status
        if s == "valid":     result["valid"] += 1
        elif s == "expiring": result["expiring_soon"] += 1
        elif s == "critical": result["critical"] += 1
        elif s == "expired":  result["expired"] += 1
        if c.expires_at and c.expires_at >= date.today():
            if soonest is None or c.expires_at < soonest.expires_at:
                soonest = c
    if soonest:
        result["next_expiry"] = {
            "id": soonest.id,
            "common_name": soonest.common_name,
            "expires_at": soonest.expires_at.isoformat(),
            "days_remaining": soonest.days_remaining,
        }
    return result

@router.get("/v1/certificates")
def list_certs(
    search: Optional[str] = None,
    status: Optional[str] = None,
    ca_type: Optional[str] = None,
    environment: Optional[str] = None,
    expiring_days: Optional[int] = None,
    page: int = 1, page_size: int = 50,
    db: Session = Depends(get_db),
    user=Depends(require_viewer),
):
    q = db.query(Certificate)
    if search:
        q = q.filter(
            Certificate.common_name.ilike(f"%{search}%") |
            Certificate.issuer.ilike(f"%{search}%") |
            Certificate.issuer_common_name.ilike(f"%{search}%")
        )
    if ca_type:
        q = q.filter(Certificate.ca_type == ca_type)
    if environment:
        q = q.filter(Certificate.environment == environment)
    if expiring_days is not None:
        deadline = date.today() + timedelta(days=expiring_days)
        q = q.filter(Certificate.expires_at <= deadline, Certificate.expires_at >= date.today())
    q = q.order_by(Certificate.expires_at.asc())
    all_certs = q.all()
    # Filter by status after loading (calculated field)
    if status:
        all_certs = [c for c in all_certs if c.cert_status == status]
    total = len(all_certs)
    data = all_certs[(page-1)*page_size : page*page_size]
    return {"data": [c.to_dict() for c in data], "total": total, "page": page, "page_size": page_size}

@router.get("/v1/certificates/{cert_id}")
def get_cert(cert_id: str, db: Session = Depends(get_db), user=Depends(require_viewer)):
    c = db.query(Certificate).filter_by(id=cert_id).first()
    if not c: raise HTTPException(404, "Certificate not found")
    return c.to_dict()

@router.post("/v1/certificates", status_code=201)
def create_cert(body: CertBody, db: Session = Depends(get_db), user=Depends(require_editor)):
    c = Certificate(**body.model_dump())
    db.add(c); db.flush()
    audit_service.record(db, ActivityType.CREATE, user=user,
        entity_type="certificate", entity_id=c.id, entity_name=c.common_name, after=c.to_dict())
    db.commit(); db.refresh(c)
    return c.to_dict()

@router.put("/v1/certificates/{cert_id}")
def update_cert(cert_id: str, body: CertBody, db: Session = Depends(get_db), user=Depends(require_editor)):
    c = db.query(Certificate).filter_by(id=cert_id).first()
    if not c: raise HTTPException(404, "Certificate not found")
    before = c.to_dict()
    for k, v in body.dict(exclude_unset=True).items():
        setattr(c, k, v)
    audit_service.record(db, ActivityType.UPDATE, user=user,
        entity_type="certificate", entity_id=c.id, entity_name=c.common_name,
        before=before, after=c.to_dict())
    db.commit(); db.refresh(c)
    return c.to_dict()

@router.delete("/v1/certificates/{cert_id}", status_code=204)
def delete_cert(cert_id: str, db: Session = Depends(get_db), user=Depends(require_editor)):
    c = db.query(Certificate).filter_by(id=cert_id).first()
    if not c: raise HTTPException(404, "Certificate not found")
    audit_service.record(db, ActivityType.DELETE, user=user,
        entity_type="certificate", entity_id=c.id, entity_name=c.common_name, before=c.to_dict())
    db.delete(c); db.commit()
