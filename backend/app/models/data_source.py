import uuid, enum
from datetime import datetime, timezone
from sqlalchemy import Column, String, Boolean, DateTime, Integer, JSON, Enum, Text
from sqlalchemy.orm import relationship
from app.database import Base

class DataSourceType(str, enum.Enum):
    vmware     = "vmware"
    veeam      = "veeam"
    edr        = "edr"
    apps       = "apps"      # servicios detectados (web servers, bases de datos)
    docker     = "docker"    # contenedores Docker
    k8s        = "k8s"       # clusters y nodos Kubernetes
    monitoring = "monitoring"
    monica     = "monica"
    api        = "api"
    database   = "database"
    manual     = "manual"

class DataSourceStatus(str, enum.Enum):
    active   = "active"
    inactive = "inactive"
    error    = "error"
    stale    = "stale"

class DataSource(Base):
    __tablename__ = "data_sources"
    id                   = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    name                 = Column(String(100), nullable=False, unique=True)
    type                 = Column(Enum(DataSourceType), nullable=False)
    description          = Column(Text, nullable=True)
    connection_config    = Column(JSON, nullable=True)
    is_active            = Column(Boolean, nullable=False, default=True)
    status               = Column(Enum(DataSourceStatus), nullable=False, default=DataSourceStatus.active)
    last_sync            = Column(DateTime(timezone=True), nullable=True)
    sync_interval_minutes = Column(Integer, nullable=False, default=60)
    priority             = Column(Integer, nullable=False, default=100)
    created_at           = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at           = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc),
                                  onupdate=lambda: datetime.now(timezone.utc))
    assets = relationship("Asset", back_populates="data_source")
