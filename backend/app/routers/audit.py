from datetime import datetime
from typing import Optional
from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.orm import Session
from app.database import get_db
from app.middleware.auth import require_admin
from app.models.audit import AuditLog, ActivityType

router = APIRouter(prefix="/v1/audit-logs", tags=["Audit Logs"])

@router.get("")
def list_audit_logs(
    activity_type: Optional[ActivityType] = None,
    user_id:       Optional[str] = None,
    entity_type:   Optional[str] = None,
    entity_id:     Optional[str] = None,
    date_from:     Optional[datetime] = None,
    date_to:       Optional[datetime] = None,
    page:      int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=100),
    db: Session = Depends(get_db),
    user: dict  = Depends(require_admin),
):
    q = db.query(AuditLog)
    if activity_type: q = q.filter(AuditLog.activity_type == activity_type)
    if user_id:       q = q.filter(AuditLog.user_id == user_id)
    if entity_type:   q = q.filter(AuditLog.entity_type == entity_type)
    if entity_id:     q = q.filter(AuditLog.entity_id == entity_id)
    if date_from:     q = q.filter(AuditLog.timestamp >= date_from)
    if date_to:       q = q.filter(AuditLog.timestamp <= date_to)
    q = q.order_by(AuditLog.timestamp.desc())
    total = q.count()
    logs  = q.offset((page - 1) * page_size).limit(page_size).all()
    def _d(l):
        return {"id": l.id, "timestamp": l.timestamp.isoformat() if l.timestamp else None,
                "user_id": l.user_id, "username": l.username, "activity_type": str(l.activity_type).split(".")[-1] if l.activity_type else None,
                "entity_type": l.entity_type, "entity_id": l.entity_id,
                "entity_name": l.entity_name, "changes": l.changes, "ip_address": l.ip_address}
    return {"data": [_d(l) for l in logs], "total": total, "page": page, "page_size": page_size}

@router.get("/{log_id}")
def get_audit_log(log_id: str, db: Session = Depends(get_db), user: dict = Depends(require_admin)):
    log = db.query(AuditLog).filter_by(id=log_id).first()
    if not log: raise HTTPException(404, "Not found")
    return {"id": log.id, "timestamp": log.timestamp.isoformat() if log.timestamp else None,
            "user_id": log.user_id, "username": log.username, "activity_type": log.activity_type,
            "entity_type": log.entity_type, "entity_id": log.entity_id,
            "entity_name": log.entity_name, "changes": log.changes,
            "ip_address": log.ip_address, "user_agent": log.user_agent}
