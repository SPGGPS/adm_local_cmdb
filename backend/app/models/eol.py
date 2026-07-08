import uuid, enum
from datetime import datetime, date, timezone
from sqlalchemy import Column, String, Boolean, Date, DateTime, Text, JSON, Enum, Index
from app.database import Base

class EolSyncStatus(str, enum.Enum):
    synced   = "synced"    # dato presente en la última sync
    unsynced = "unsynced"  # desapareció de endoflife.date (marcado, no borrado)

class EolProduct(Base):
    """Producto de endoflife.date — ej: 'ubuntu', 'python', 'rhel'."""
    __tablename__ = "eol_products"

    id           = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    product_id   = Column(String(100), nullable=False, unique=True, index=True)  # slug de la API, ej: "ubuntu"
    display_name = Column(String(200), nullable=True)    # nombre legible, custom o el de la API
    category     = Column(String(100), nullable=True)    # OS, Database, Language, Framework…
    notes        = Column(Text, nullable=True)           # notas libres del admin
    sync_status  = Column(Enum(EolSyncStatus), nullable=False, default=EolSyncStatus.synced)
    last_synced_at = Column(DateTime(timezone=True), nullable=True)
    created_at   = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at   = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc),
                          onupdate=lambda: datetime.now(timezone.utc))

    def to_dict(self):
        return {
            "id": self.id,
            "product_id": self.product_id,
            "display_name": self.display_name or self.product_id,
            "category": self.category,
            "notes": self.notes,
            "sync_status": str(self.sync_status).split(".")[-1],
            "last_synced_at": self.last_synced_at.isoformat() if self.last_synced_at else None,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }

class EolCycle(Base):
    """Ciclo de vida de una versión concreta — ej: Ubuntu 22.04, Python 3.11."""
    __tablename__ = "eol_cycles"
    __table_args__ = (
        Index("ix_eol_cycles_product_cycle", "product_id", "cycle"),
    )

    id           = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    product_id   = Column(String(100), nullable=False, index=True)  # FK lógica a eol_products.product_id
    cycle        = Column(String(50), nullable=False)               # ej: "22.04", "3.11", "8"
    # Datos de la API
    release_date = Column(Date, nullable=True)
    eol_date     = Column(Date, nullable=True)   # null = aún sin fecha / false = no tiene EOL
    eol_boolean  = Column(Boolean, nullable=True) # cuando la API devuelve true/false en vez de fecha
    support_end  = Column(Date, nullable=True)   # fin de soporte activo (antes del EOL)
    lts          = Column(Boolean, default=False)
    latest       = Column(String(50), nullable=True)   # última versión del ciclo
    link         = Column(String(500), nullable=True)  # enlace al changelog
    # Valores custom (sobrescriben los de la API en la UI)
    custom_eol_date    = Column(Date, nullable=True)   # fecha EOL personalizada
    custom_notes       = Column(Text, nullable=True)   # notas sobre este ciclo
    # Estado sync
    sync_status  = Column(Enum(EolSyncStatus), nullable=False, default=EolSyncStatus.synced)
    last_synced_at = Column(DateTime(timezone=True), nullable=True)
    # Raw data de la API para no perder nada
    raw_data     = Column(JSON, nullable=True)

    @property
    def effective_eol_date(self):
        """custom_eol_date tiene prioridad sobre eol_date de la API."""
        return self.custom_eol_date or self.eol_date

    @property
    def eol_status(self):
        """
        Calcula el estado EOL para mostrar el badge en activos:
          'eol'      → ya sin soporte  (rojo)
          'warning'  → ≤ 1 año para EOL (amarillo)
          'ok'       → > 2 años para EOL (verde)
          'unknown'  → sin fecha
        """
        if self.eol_boolean is True:
            return "eol"
        d = self.effective_eol_date
        if not d:
            return "unknown"
        today = date.today()
        if d <= today:
            return "eol"
        days_left = (d - today).days
        if days_left <= 365:
            return "warning"
        if days_left <= 730:
            return "warning"   # ≤ 2 años → amarillo
        return "ok"            # > 2 años → verde

    def to_dict(self):
        return {
            "id": self.id,
            "product_id": self.product_id,
            "cycle": self.cycle,
            "release_date": self.release_date.isoformat() if self.release_date else None,
            "eol_date": self.eol_date.isoformat() if self.eol_date else None,
            "eol_boolean": self.eol_boolean,
            "support_end": self.support_end.isoformat() if self.support_end else None,
            "lts": self.lts,
            "latest": self.latest,
            "link": self.link,
            "custom_eol_date": self.custom_eol_date.isoformat() if self.custom_eol_date else None,
            "custom_notes": self.custom_notes,
            "effective_eol_date": self.effective_eol_date.isoformat() if self.effective_eol_date else None,
            "eol_status": self.eol_status,
            "sync_status": str(self.sync_status).split(".")[-1],
            "last_synced_at": self.last_synced_at.isoformat() if self.last_synced_at else None,
            "raw_data": self.raw_data,
        }
