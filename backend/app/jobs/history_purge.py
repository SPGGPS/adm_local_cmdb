"""K8s CronJob: elimina snapshots de asset_history y entradas de asset_change_log antiguos."""
import os, logging
from datetime import datetime, timezone, timedelta

logging.basicConfig(level="INFO", format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("job.history_purge")

RETENTION_DAYS = int(os.getenv("RETENTION_DAYS", "365"))

if __name__ == "__main__":
    from app.database import SessionLocal, init_db
    from app.models.asset import AssetHistory, AssetChangeLog
    init_db()
    db = SessionLocal()
    try:
        cutoff = datetime.now(timezone.utc) - timedelta(days=RETENTION_DAYS)
        deleted_h = db.query(AssetHistory).filter(AssetHistory.snapshot_at < cutoff).delete()
        deleted_c = db.query(AssetChangeLog).filter(AssetChangeLog.changed_at < cutoff).delete()
        db.commit()
        logger.info(f"history_purge: {deleted_h} snapshots + {deleted_c} changelog entries eliminados (retención {RETENTION_DAYS}d)")
    finally:
        db.close()
