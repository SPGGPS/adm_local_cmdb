import logging
from datetime import datetime, timezone
from typing import Optional
from sqlalchemy.orm import Session
from app.models.audit import AuditLog, ActivityType

logger = logging.getLogger("tfg.audit")

def _diff(before, after):
    if before is None and after is not None: return {"added": after}
    if before is not None and after is None: return {"removed": before}
    if not before and not after: return {}
    # Excluir campos de auditoría ruidosos
    SKIP = {"updated_at","last_sync","tags","exceptions","created_at"}
    changed = {}
    for key in set(list(before.keys()) + list(after.keys())):
        if key in SKIP: continue
        v_b, v_a = before.get(key), after.get(key)
        if v_b != v_a:
            changed[key] = {"before": v_b, "after": v_a}
    return {"changed": changed, "before": before, "after": after} if changed else {}

def record(db: Session, activity_type: ActivityType, *, user=None,
           entity_type=None, entity_id=None, entity_name=None,
           before=None, after=None, ip_address=None, user_agent=None):
    log = AuditLog(
        timestamp=datetime.now(timezone.utc),
        user_id=user.get("sub") if user else None,
        username=user.get("preferred_username") if user else None,
        activity_type=activity_type,
        entity_type=entity_type,
        entity_id=str(entity_id) if entity_id else None,
        entity_name=entity_name,
        changes=_diff(before, after),
        ip_address=ip_address,
        user_agent=user_agent,
    )
    db.add(log)
    return log
