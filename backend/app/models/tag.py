import uuid, enum
from datetime import datetime, timezone
from sqlalchemy import Column, String, DateTime, Table, ForeignKey, Enum
from sqlalchemy.orm import relationship
from app.database import Base

class TagOrigin(str, enum.Enum):
    system = "system"
    manual = "manual"

asset_tag = Table(
    "asset_tag", Base.metadata,
    Column("asset_id", String, ForeignKey("assets.id", ondelete="CASCADE"), primary_key=True),
    Column("tag_id",   String, ForeignKey("tags.id",   ondelete="CASCADE"), primary_key=True),
)

class Tag(Base):
    __tablename__ = "tags"
    id          = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    name        = Column(String(100), nullable=False, unique=True)
    color_code  = Column(String(7),   nullable=False, default="#6366f1")
    description = Column(String(255), nullable=True)
    origin      = Column(Enum(TagOrigin), nullable=False, default=TagOrigin.manual)
    created_by  = Column(String(255), nullable=True)
    created_at  = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at  = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc),
                         onupdate=lambda: datetime.now(timezone.utc))
    assets = relationship("Asset", secondary=asset_tag, back_populates="tags")
