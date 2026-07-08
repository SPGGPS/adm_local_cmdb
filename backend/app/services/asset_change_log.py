import uuid, logging
from datetime import datetime, timezone, date
from sqlalchemy import event
from sqlalchemy.orm import ColumnProperty, Session

logger = logging.getLogger("tfg.changelog")

_SKIP_FIELDS = frozenset({"updated_at", "created_at", "last_sync"})

def _serialize(val):
    if val is None:
        return None
    if isinstance(val, datetime):
        return val.isoformat()
    if isinstance(val, date):
        return val.isoformat()
    return val

def register_listener():
    from app.models.asset import Asset, AssetChangeLog

    @event.listens_for(Asset, "before_update")
    def _capture(mapper, connection, target):
        from sqlalchemy import inspect as sa_inspect
        state = sa_inspect(target)
        changes = {}
        for prop in mapper.iterate_properties:
            if not isinstance(prop, ColumnProperty):
                continue
            key = prop.key
            if key in _SKIP_FIELDS:
                continue
            hist = state.attrs[key].history
            if hist.has_changes():
                old = hist.deleted[0] if hist.deleted else None
                new = hist.added[0] if hist.added else None
                if old != new:
                    changes[key] = (old, new)
        target._pending_changes = changes

    @event.listens_for(Asset, "after_update")
    def _record(mapper, connection, target):
        changes = getattr(target, "_pending_changes", {})
        if not changes:
            return
        now = datetime.now(timezone.utc)
        source = getattr(target, "_change_source", None)
        for field, (old, new) in changes.items():
            connection.execute(
                AssetChangeLog.__table__.insert().values(
                    id=str(uuid.uuid4()),
                    asset_id=target.id,
                    field=field,
                    old_value=_serialize(old),
                    new_value=_serialize(new),
                    changed_at=now,
                    source=source,
                )
            )
        target._pending_changes = {}

def get_asset_changelog(db: Session, asset_id: str, field: str = None,
                        from_dt: datetime = None, to_dt: datetime = None,
                        limit: int = 200):
    from app.models.asset import AssetChangeLog
    q = db.query(AssetChangeLog).filter(AssetChangeLog.asset_id == asset_id)
    if field:
        q = q.filter(AssetChangeLog.field == field)
    if from_dt:
        q = q.filter(AssetChangeLog.changed_at >= from_dt)
    if to_dt:
        q = q.filter(AssetChangeLog.changed_at <= to_dt)
    return q.order_by(AssetChangeLog.changed_at.desc()).limit(limit).all()

def purge_old_entries(db: Session, retention_days: int = 365) -> int:
    from datetime import timedelta
    from app.models.asset import AssetChangeLog
    cutoff = datetime.now(timezone.utc) - timedelta(days=retention_days)
    n = db.query(AssetChangeLog).filter(AssetChangeLog.changed_at < cutoff).delete()
    db.commit()
    return n
