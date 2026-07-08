from datetime import datetime, timezone
from sqlalchemy import Column, String, DateTime
from app.database import Base

class UserProfile(Base):
    __tablename__ = "user_profiles"

    user_id               = Column(String(255), primary_key=True)
    avatar_filename       = Column(String(255), nullable=True)
    last_login_at         = Column(DateTime(timezone=True), nullable=True)
    last_login_ip         = Column(String(45), nullable=True)
    last_failed_login_at  = Column(DateTime(timezone=True), nullable=True)
    last_failed_login_ip  = Column(String(45), nullable=True)
    created_at            = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at            = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc),
                                   onupdate=lambda: datetime.now(timezone.utc))
