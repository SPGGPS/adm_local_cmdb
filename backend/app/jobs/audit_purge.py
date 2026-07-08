"""K8s CronJob: elimina audit logs con más de RETENTION_DAYS días."""
import os, logging
from datetime import datetime, timezone, timedelta

logging.basicConfig(level="INFO", format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("job.audit_purge")

RETENTION_DAYS = int(os.getenv("RETENTION_DAYS", "180"))

if __name__ == "__main__":
    from app.database import SessionLocal, init_db
    from app.models import AuditLog
    init_db()
    db = SessionLocal()
    try:
        cutoff = datetime.now(timezone.utc) - timedelta(days=RETENTION_DAYS)
        deleted = db.query(AuditLog).filter(AuditLog.timestamp < cutoff).delete()
        db.commit()
        logger.info(f"audit_purge: {deleted} logs eliminados (retención {RETENTION_DAYS}d)")
    finally:
        db.close()
