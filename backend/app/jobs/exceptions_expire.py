"""K8s CronJob: registra en log las excepciones de compliance expiradas."""
import logging
from datetime import datetime, timezone

logging.basicConfig(level="INFO", format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("job.exceptions_expire")

if __name__ == "__main__":
    from app.database import SessionLocal, init_db
    from app.models.exception import ComplianceException
    init_db()
    db = SessionLocal()
    try:
        now = datetime.now(timezone.utc)
        expired = db.query(ComplianceException).filter(
            ComplianceException.revoked_at == None,  
            ComplianceException.expires_at != None,  
            ComplianceException.expires_at <= now,
        ).all()
        logger.info(f"exceptions_expire: {len(expired)} excepciones expiradas encontradas")
        for exc in expired:
            logger.info(f"  - asset_id={exc.asset_id} indicator={exc.indicator} expires_at={exc.expires_at}")
    finally:
        db.close()
