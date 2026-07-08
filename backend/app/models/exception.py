import uuid, enum
from datetime import datetime, timezone
from sqlalchemy import Column, String, DateTime, Text, Enum, ForeignKey
from sqlalchemy.orm import relationship
from app.database import Base

class ComplianceIndicator(str, enum.Enum):
    edr   = "edr"
    mon   = "mon"
    siem  = "siem"
    logs  = "logs"
    bck   = "bck"
    bckcl = "bckcl"

class ExceptionReasonCode(str, enum.Enum):
    agent_not_supported  = "agent_not_supported"
    network_device       = "network_device"
    excluded_backup      = "excluded_backup"
    excluded_monitoring  = "excluded_monitoring"
    excluded_siem        = "excluded_siem"
    legacy_system        = "legacy_system"
    pending_deployment   = "pending_deployment"
    decommissioning      = "decommissioning"
    cloud_backup_only    = "cloud_backup_only"
    local_backup_only    = "local_backup_only"
    temporary_exclusion  = "temporary_exclusion"
    other                = "other"

REASON_LABELS = {
    "agent_not_supported": "Agente no compatible con el hardware o sistema operativo del dispositivo",
    "network_device":      "Dispositivo de red (switch/router/AP) — no admite instalación de agentes",
    "excluded_backup":     "Excluido de política de backup por decisión de negocio aprobada",
    "excluded_monitoring": "Excluido de monitorización — entorno aislado, de pruebas o DMZ",
    "excluded_siem":       "Excluido de envío de logs a SIEM — dato clasificado o entorno restringido",
    "legacy_system":       "Sistema legacy sin soporte para herramientas de seguridad actuales",
    "pending_deployment":  "Pendiente de despliegue — instalación/configuración en curso",
    "decommissioning":     "Activo en proceso de baja o retirada programada",
    "cloud_backup_only":   "Política de solo backup en cloud, sin backup local",
    "local_backup_only":   "Política de solo backup local, sin backup cloud",
    "temporary_exclusion": "Exclusión temporal por mantenimiento o ventana de cambio",
    "other":               "Otro motivo",
}

class ComplianceException(Base):
    __tablename__ = "compliance_exceptions"
    id              = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    asset_id        = Column(String, ForeignKey("assets.id", ondelete="CASCADE"), nullable=False, index=True)
    indicator       = Column(Enum(ComplianceIndicator), nullable=False, index=True)
    reason_code     = Column(Enum(ExceptionReasonCode), nullable=False)
    reason          = Column(Text, nullable=False)   # concatenated: label + description
    created_by      = Column(String(255), nullable=False)
    created_by_name = Column(String(255), nullable=False)
    created_at      = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))
    expires_at      = Column(DateTime(timezone=True), nullable=True, index=True)
    revoked_by      = Column(String(255), nullable=True)
    revoked_by_name = Column(String(255), nullable=True)
    revoked_at      = Column(DateTime(timezone=True), nullable=True, index=True)
    asset = relationship("Asset", back_populates="exceptions",
                         foreign_keys=[asset_id], overlaps="exceptions")

    @property
    def is_active(self):
        now = datetime.now(timezone.utc)
        return self.revoked_at is None and (self.expires_at is None or self.expires_at > now)

    @property
    def status(self):
        if self.revoked_at is not None: return "revoked"
        now = datetime.now(timezone.utc)
        if self.expires_at and self.expires_at <= now: return "expired"
        return "active"

    def to_dict(self):
        return {
            "id": self.id, "asset_id": self.asset_id,
            "asset_name": self.asset.name if self.asset else None,
            "indicator": self.indicator, "reason_code": str(self.reason_code).split(".")[-1] if self.reason_code else None,
            "reason": self.reason, "created_by": self.created_by,
            "created_by_name": self.created_by_name,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "expires_at": self.expires_at.isoformat() if self.expires_at else None,
            "revoked_by": self.revoked_by, "revoked_by_name": self.revoked_by_name,
            "revoked_at": self.revoked_at.isoformat() if self.revoked_at else None,
            "status": self.status,
        }
