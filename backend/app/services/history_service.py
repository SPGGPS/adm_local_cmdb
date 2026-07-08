import logging
from datetime import datetime, timezone, timedelta
from sqlalchemy.orm import Session
from sqlalchemy import func
from app.models.asset import Asset, AssetHistory

logger = logging.getLogger("tfg.history")
RETENTION_DAYS = 365

def take_snapshot(db: Session) -> int:
    now = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
    assets = db.query(Asset).all()
    for asset in assets:
        db.add(AssetHistory(asset_id=asset.id, snapshot_at=now, snapshot=asset.to_dict()))
    db.commit()
    logger.info(f"Snapshot {now.isoformat()} — {len(assets)} assets")
    return len(assets)

def get_assets_at(db: Session, as_of: datetime):
    subq = (
        db.query(AssetHistory.asset_id, func.max(AssetHistory.snapshot_at).label("latest"))
        .filter(AssetHistory.snapshot_at <= as_of)
        .group_by(AssetHistory.asset_id)
        .subquery()
    )
    rows = (
        db.query(AssetHistory)
        .join(subq, (AssetHistory.asset_id == subq.c.asset_id) & (AssetHistory.snapshot_at == subq.c.latest))
        .all()
    )
    return [r.snapshot for r in rows]

def get_available_snapshots(db: Session):
    rows = (
        db.query(AssetHistory.snapshot_at).distinct()
        .order_by(AssetHistory.snapshot_at.desc()).limit(8760).all()
    )
    return [r.snapshot_at.isoformat() for r in rows]

def purge_old_snapshots(db: Session) -> int:
    cutoff = datetime.now(timezone.utc) - timedelta(days=RETENTION_DAYS)
    n = db.query(AssetHistory).filter(AssetHistory.snapshot_at < cutoff).delete()
    db.commit()
    return n
