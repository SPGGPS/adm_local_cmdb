import uuid, enum
from datetime import datetime, timezone
from sqlalchemy import Column, String, DateTime, JSON, Enum, Text
from app.database import Base

class ActivityType(str, enum.Enum):
    # CRUD general
    CREATE     = "CREATE"
    UPDATE     = "UPDATE"
    DELETE     = "DELETE"
    # Etiquetas
    TAG_ASSIGN = "TAG_ASSIGN"
    TAG_REMOVE = "TAG_REMOVE"
    # Auth
    LOGIN      = "LOGIN"
    LOGOUT     = "LOGOUT"
    LOGIN_FAIL = "LOGIN_FAIL"
    # Ingesta
    INGEST     = "INGEST"
    # EOL
    EOL_SYNC         = "EOL_SYNC"        # sync de producto desde endoflife.date
    EOL_SYNC_ALL     = "EOL_SYNC_ALL"    # sync de todos los productos
    EOL_OVERRIDE     = "EOL_OVERRIDE"    # sobrescritura de fecha EOL
    EOL_RETAG        = "EOL_RETAG"       # recálculo de etiquetas EOL
    # Localización
    LOCATION_ASSIGN  = "LOCATION_ASSIGN" # asignar asset(s) a celda
    # Componentes de servicio
    COMPONENT_ADD    = "COMPONENT_ADD"
    COMPONENT_REMOVE = "COMPONENT_REMOVE"
    ENDPOINT_ADD     = "ENDPOINT_ADD"
    ENDPOINT_REMOVE  = "ENDPOINT_REMOVE"
    DEPENDENCY_ADD   = "DEPENDENCY_ADD"
    DEPENDENCY_REMOVE= "DEPENDENCY_REMOVE"
    INFRA_BIND       = "INFRA_BIND"
    INFRA_UNBIND     = "INFRA_UNBIND"
    # Excepciones
    EXCEPTION_REVOKE = "EXCEPTION_REVOKE"

class AuditLog(Base):
    __tablename__ = "audit_logs"
    id            = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    timestamp     = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc), index=True)
    user_id       = Column(String(255), nullable=True, index=True)
    username      = Column(String(255), nullable=True)
    activity_type = Column(Enum(ActivityType), nullable=False, index=True)
    entity_type   = Column(String(50), nullable=True)
    entity_id     = Column(String, nullable=True)
    entity_name   = Column(String(255), nullable=True)
    changes       = Column(JSON, nullable=True)
    ip_address    = Column(String(45), nullable=True)
    user_agent    = Column(Text, nullable=True)
