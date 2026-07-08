import uuid
from datetime import datetime, timezone
from sqlalchemy import Column, String, Text, ForeignKey, DateTime, Boolean
from sqlalchemy.orm import relationship
from app.database import Base

# Zona
# Agrupación lógica de varias ubicaciones físicas (ej: "Zona Norte Madrid",
# "Instalaciones Organización", "Nube AWS eu-west-1")

class Zone(Base):
    __tablename__ = "zones"

    id          = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    name        = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)
    created_at  = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at  = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc),
                         onupdate=lambda: datetime.now(timezone.utc))

    sites = relationship("Site", back_populates="zone", cascade="all, delete-orphan")

    def to_dict(self, include_sites=False):
        try:
            sites = list(self.sites) if self.sites is not None else []
        except Exception:
            sites = []
        d = {
            "id": self.id, "name": self.name, "description": self.description,
            "site_count": len(sites),
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }
        if include_sites:
            d["sites"] = [s.to_dict(include_cells=True) for s in sites]
        return d

# Site (Localización física)
# Un edificio o campus físico concreto dentro de una zona
# Ej: "Organización — Edificio Principal", "CPD Externo Rackspace"

class Site(Base):
    __tablename__ = "sites"

    id          = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    zone_id     = Column(String, ForeignKey("zones.id", ondelete="CASCADE"), nullable=False)
    name        = Column(String(200), nullable=False)
    address     = Column(String(500), nullable=True)
    description = Column(Text, nullable=True)
    created_at  = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at  = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc),
                         onupdate=lambda: datetime.now(timezone.utc))

    zone  = relationship("Zone", back_populates="sites")
    cells = relationship("Cell", back_populates="site", cascade="all, delete-orphan")

    def to_dict(self, include_cells=False):
        d = {
            "id": self.id, "zone_id": self.zone_id,
            "zone_name": self.zone.name if self.zone else None,
            "name": self.name, "address": self.address, "description": self.description,
            "cell_count": len(self.cells) if self.cells else 0,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }
        if include_cells:
            d["cells"] = [c.to_dict() for c in self.cells]
        return d

# Cell (Celda / CPD / Sala / Rack)
# Ubicación precisa dentro de un site: sala de servidores, rack específico,
# armario de comunicaciones, etc. Es donde se asignan los assets.

CELL_TYPES = ["datacenter", "serverroom", "rack", "cabinet", "floor", "zone", "other"]

class Cell(Base):
    __tablename__ = "cells"

    id          = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    site_id     = Column(String, ForeignKey("sites.id", ondelete="CASCADE"), nullable=False)
    name        = Column(String(200), nullable=False)
    cell_type   = Column(String(50), nullable=True)   # datacenter, serverroom, rack, cabinet…
    row_id      = Column(String(50), nullable=True)   # Fila dentro del CPD, ej: "Fila A"
    rack_unit   = Column(String(50), nullable=True)   # Posición rack, ej: "U12-U14"
    description = Column(Text, nullable=True)
    created_at  = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at  = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc),
                         onupdate=lambda: datetime.now(timezone.utc))

    site = relationship("Site", back_populates="cells")

    def to_dict(self):
        return {
            "id": self.id, "site_id": self.site_id,
            "site_name": self.site.name if self.site else None,
            "zone_name": self.site.zone.name if self.site and self.site.zone else None,
            "name": self.name, "cell_type": self.cell_type,
            "row_id": self.row_id, "rack_unit": self.rack_unit,
            "description": self.description,
            "full_path": self._full_path(),
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }

    def _full_path(self):
        parts = []
        if self.site and self.site.zone:
            parts.append(self.site.zone.name)
        if self.site:
            parts.append(self.site.name)
        parts.append(self.name)
        return " › ".join(parts)
