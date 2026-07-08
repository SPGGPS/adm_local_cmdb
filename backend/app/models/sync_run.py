import uuid
from datetime import datetime, timezone
from sqlalchemy import Column, String, Integer, DateTime, JSON, ForeignKey
from app.database import Base

class SyncRun(Base):
    __tablename__ = "sync_runs"
    id             = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    data_source_id = Column(String, ForeignKey("data_sources.id", ondelete="CASCADE"), nullable=False)
    run_at         = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    created_count  = Column(Integer, default=0)
    updated_count  = Column(Integer, default=0)
    matched_count  = Column(Integer, default=0)   # actualizados sin cambios de campo
    assets_created  = Column(JSON, default=list)   # [{id, name, type}]
    assets_updated  = Column(JSON, default=list)   # [{id, name, type, changed_fields}]
    skipped_count   = Column(Integer, default=0)
    assets_skipped  = Column(JSON, default=list)   # [{name, mac, conflicts_with, conflicts_with_id}]
    # sync_run_id agrupa todos los batches de una misma ejecución de DAG en un único SyncRun.
    sync_run_id    = Column(String, nullable=True, index=True)
    # label identifica el origen concreto dentro de una fuente (ej: hostname del vCenter)
    label          = Column(String, nullable=True)
