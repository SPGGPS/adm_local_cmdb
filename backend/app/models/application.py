import uuid, enum
from datetime import datetime, timezone
from sqlalchemy import Column, String, Boolean, DateTime, Integer, JSON, ForeignKey, Enum, Text, CheckConstraint
from sqlalchemy.orm import relationship
from app.database import Base

class AppEnvironment(str, enum.Enum):
    production = "production"; staging = "staging"; development = "development"; dr = "dr"

class AppStatus(str, enum.Enum):
    active = "active"; inactive = "inactive"; deprecated = "deprecated"; maintenance = "maintenance"

class ServiceStatus(str, enum.Enum):
    active = "active"; degraded = "degraded"; maintenance = "maintenance"; inactive = "inactive"

class ServiceCriticality(str, enum.Enum):
    critical = "critical"; high = "high"; medium = "medium"; low = "low"

class ServiceCategory(str, enum.Enum):
    citizen_portal = "citizen_portal"; internal_tool = "internal_tool"
    infrastructure = "infrastructure"; integration = "integration"; other = "other"

class ComponentRole(str, enum.Enum):
    frontend="frontend"; backend="backend"; api_gateway="api_gateway"; auth="auth"
    worker="worker"; scheduler="scheduler"; cache="cache"; cdn="cdn"
    database_proxy="database_proxy"; message_broker="message_broker"; monitoring="monitoring"
    ingress="ingress"; load_balancer="load_balancer"; other="other"

class BindingType(str, enum.Enum):
    runs_on="runs_on"; hosted_on="hosted_on"; uses_database="uses_database"
    uses_cache="uses_cache"; load_balanced_by="load_balanced_by"
    proxied_by="proxied_by"; monitored_by="monitored_by"; backed_up_by="backed_up_by"

class BindingTier(str, enum.Enum):
    entry_point="entry_point"; gateway="gateway"; certificate="certificate"
    application="application"; auth="auth"; cache="cache"; data="data"
    compute="compute"; storage="storage"; network="network"

TIER_ORDER = {
    "entry_point":1,"gateway":2,"certificate":3,
    "application":4,"auth":4,"cache":5,"data":5,
    "compute":6,"storage":7,"network":8,
}
TIER_LABELS = {
    "entry_point":"Punto de entrada","gateway":"Gateway / Proxy","certificate":"Certificados TLS",
    "application":"Aplicación / Auth","auth":"Aplicación / Auth","cache":"Datos / Caché",
    "data":"Datos / Caché","compute":"Cómputo","storage":"Almacenamiento","network":"Red",
}

class DepType(str, enum.Enum):
    calls_api="calls_api"; authenticates_via="authenticates_via"
    reads_from="reads_from"; writes_to="writes_to"
    publishes_to="publishes_to"; subscribes_to="subscribes_to"
    proxied_through="proxied_through"; other="other"

class EndpointType(str, enum.Enum):
    public="public"; internal="internal"; vpn="vpn"; api="api"; webhook="webhook"

class Application(Base):
    __tablename__ = "applications"
    id          = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    name        = Column(String(200), nullable=False, unique=True)
    description = Column(Text, nullable=True)
    version     = Column(String(50), nullable=True)
    repo_url    = Column(String(500), nullable=True)
    docs_url    = Column(String(500), nullable=True)
    tech_stack  = Column(JSON, nullable=True, default=list)
    owner_team  = Column(String(100), nullable=True)
    environment = Column(Enum(AppEnvironment), nullable=False, default=AppEnvironment.production)
    status      = Column(Enum(AppStatus), nullable=False, default=AppStatus.active)
    cell_id     = Column(String, ForeignKey("cells.id", ondelete="SET NULL"), nullable=True)
    created_at  = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at  = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
    service_components = relationship("ServiceComponent", back_populates="application", cascade="all, delete-orphan")
    infra_bindings     = relationship("AppInfraBinding", back_populates="application", cascade="all, delete-orphan")
    outgoing_deps      = relationship("AppDependency", foreign_keys="AppDependency.source_app_id", back_populates="source_app", cascade="all, delete-orphan")
    incoming_deps      = relationship("AppDependency", foreign_keys="AppDependency.target_app_id", back_populates="target_app", cascade="all, delete-orphan")

    def to_dict(self):
        # Obtener full_path de la celda si está asignada
        cell_full_path = None
        cell_name = None
        try:
            if self.cell_id:
                from sqlalchemy.orm import object_session
                sess = object_session(self)
                if sess:
                    from app.models.location import Cell
                    cell = sess.query(Cell).filter_by(id=self.cell_id).first()
                    if cell:
                        cell_full_path = cell.to_dict().get("full_path")
                        cell_name = cell.name
        except Exception:
            pass
        return {"id":self.id,"name":self.name,"description":self.description,"version":self.version,
                "repo_url":self.repo_url,"docs_url":self.docs_url,"tech_stack":self.tech_stack or [],
                "owner_team":self.owner_team,
                "environment": str(self.environment).split(".")[-1] if self.environment else None,
                "status": str(self.status).split(".")[-1] if self.status else None,
                "cell_id":self.cell_id, "cell_name": cell_name, "cell_full_path": cell_full_path,
                "created_at":self.created_at.isoformat() if self.created_at else None,
                "updated_at":self.updated_at.isoformat() if self.updated_at else None}

class Service(Base):
    __tablename__ = "services"
    id          = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    name        = Column(String(200), nullable=False, unique=True)
    description = Column(Text, nullable=True)
    category    = Column(Enum(ServiceCategory), nullable=True, default=ServiceCategory.internal_tool)
    status      = Column(Enum(ServiceStatus), nullable=False, default=ServiceStatus.active)
    criticality = Column(Enum(ServiceCriticality), nullable=False, default=ServiceCriticality.medium)
    owner_team  = Column(String(100), nullable=True)
    created_at  = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at  = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
    components = relationship("ServiceComponent", back_populates="service", cascade="all, delete-orphan")
    endpoints  = relationship("ServiceEndpoint", back_populates="service", cascade="all, delete-orphan")

    def to_dict(self):
        return {"id":self.id,"name":self.name,"description":self.description,"category":self.category,
                "status":self.status,"criticality":self.criticality,"owner_team":self.owner_team,
                "components":[c.to_dict() for c in self.components],
                "endpoints":[e.to_dict() for e in self.endpoints],
                "created_at":self.created_at.isoformat() if self.created_at else None}

class ServiceEndpoint(Base):
    __tablename__ = "service_endpoints"
    id             = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    service_id     = Column(String, ForeignKey("services.id", ondelete="CASCADE"), nullable=False)
    url            = Column(String(500), nullable=False)
    type           = Column(Enum(EndpointType), nullable=False, default=EndpointType.public)
    description    = Column(String(200), nullable=True)
    is_primary     = Column(Boolean, default=False)
    certificate_id = Column(String, ForeignKey("certificates.id", ondelete="SET NULL"), nullable=True)
    service = relationship("Service", back_populates="endpoints")

    @property
    def tls_status(self):
        # Lazy import to avoid circular
        if not self.certificate_id: return "none"
        from sqlalchemy.orm import object_session
        sess = object_session(self)
        if not sess: return "none"
        from app.models.certificate import Certificate
        cert = sess.query(Certificate).filter_by(id=self.certificate_id).first()
        return cert.cert_status if cert else "none"

    def to_dict(self):
        return {
            "id": self.id, "service_id": self.service_id,
            "url": self.url,
            "type": str(self.type).split(".")[-1] if self.type else "public",
            "description": self.description,
            "is_primary": self.is_primary,
            "certificate_id": self.certificate_id,
            "tls_status": self.tls_status,
        }

class ServiceComponent(Base):
    __tablename__ = "service_components"
    id             = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    service_id     = Column(String, ForeignKey("services.id", ondelete="CASCADE"), nullable=False)
    application_id = Column(String, ForeignKey("applications.id", ondelete="CASCADE"), nullable=False)
    role           = Column(Enum(ComponentRole), nullable=False, default=ComponentRole.backend)
    role_notes     = Column(String(200), nullable=True)
    order_index    = Column(Integer, default=0)
    service     = relationship("Service", back_populates="components")
    application = relationship("Application", back_populates="service_components")
    def to_dict(self):
        return {"id":self.id,"service_id":self.service_id,"application_id":self.application_id,
                "application_name":self.application.name if self.application else None,
                "role":self.role,"role_notes":self.role_notes,"order_index":self.order_index}

class AppInfraBinding(Base):
    __tablename__ = "app_infra_bindings"
    id                        = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    application_id            = Column(String, ForeignKey("applications.id", ondelete="CASCADE"), nullable=False)
    asset_id                  = Column(String, ForeignKey("assets.id", ondelete="SET NULL"), nullable=True)
    binding_tier              = Column(Enum(BindingTier), nullable=False, default=BindingTier.compute)
    tier_order_override       = Column(Integer, nullable=True)
    is_critical               = Column(Boolean, default=True)
    is_single_point_of_failure = Column(Boolean, default=False)
    redundancy_group          = Column(String(100), nullable=True)
    communication_port        = Column(Integer, nullable=True)   # puerto de comunicación entre capas (ej: 443, 5432, 6379)
    notes                     = Column(String(300), nullable=True)
    application = relationship("Application", back_populates="infra_bindings")

    @property
    def tier_order_effective(self):
        if self.tier_order_override is not None:
            return self.tier_order_override
        return TIER_ORDER.get(str(self.binding_tier).split(".")[-1], 99)

    def to_dict(self):
        from app.models.asset import Asset
        tier_key = str(self.binding_tier).split(".")[-1] if self.binding_tier else "compute"
        return {
            "id": self.id,
            "application_id": self.application_id,
            "asset_id": self.asset_id,
            "binding_tier": tier_key,
            "tier_order_override": self.tier_order_override,
            "tier_order_effective": self.tier_order_effective,
            "is_critical": self.is_critical,
            "is_single_point_of_failure": self.is_single_point_of_failure,
            "redundancy_group": self.redundancy_group,
            "communication_port": self.communication_port,
            "notes": self.notes,
        }

class AppDependency(Base):
    __tablename__ = "app_dependencies"
    __table_args__ = (CheckConstraint("source_app_id != target_app_id"),)
    id            = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    source_app_id = Column(String, ForeignKey("applications.id", ondelete="CASCADE"), nullable=False)
    target_app_id = Column(String, ForeignKey("applications.id", ondelete="CASCADE"), nullable=False)
    dep_type      = Column(Enum(DepType), nullable=False)
    is_critical   = Column(Boolean, default=True)
    notes         = Column(String(200), nullable=True)
    source_app = relationship("Application", foreign_keys=[source_app_id], back_populates="outgoing_deps")
    target_app = relationship("Application", foreign_keys=[target_app_id], back_populates="incoming_deps")
    def to_dict(self):
        return {"id":self.id,"source_app_id":self.source_app_id,"target_app_id":self.target_app_id,
                "source_app_name":self.source_app.name if self.source_app else None,
                "target_app_name":self.target_app.name if self.target_app else None,
                "dep_type":self.dep_type,"is_critical":self.is_critical,"notes":self.notes}
