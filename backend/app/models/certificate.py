import uuid, enum
from datetime import datetime, date, timezone
from sqlalchemy import Column, String, Boolean, DateTime, Date, Text, Enum, JSON, Index, ForeignKey
from app.database import Base

class KeyType(str, enum.Enum):
    rsa_2048="rsa_2048"; rsa_4096="rsa_4096"; ecdsa_256="ecdsa_256"
    ecdsa_384="ecdsa_384"; ed25519="ed25519"; other="other"

class CAType(str, enum.Enum):
    public_trusted="public_trusted"; fnmt="fnmt"
    internal_ca="internal_ca"; self_signed="self_signed"; unknown="unknown"

class CertEnvironment(str, enum.Enum):
    production="production"; staging="staging"; development="development"; dr="dr"

class Certificate(Base):
    __tablename__ = "certificates"

    id                    = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    common_name           = Column(String(255), nullable=False)
    san_domains           = Column(JSON, default=list)
    serial_number         = Column(String(100), nullable=True)
    fingerprint_sha256    = Column(String(100), nullable=True, index=True)
    fingerprint_sha1      = Column(String(60), nullable=True)

    issued_at             = Column(Date, nullable=True)
    expires_at            = Column(Date, nullable=False, index=True)
    not_before            = Column(Date, nullable=True)

    issuer                = Column(String(255), nullable=True)
    issuer_common_name    = Column(String(255), nullable=True)
    issuer_organization   = Column(String(255), nullable=True)
    issuer_country        = Column(String(2), nullable=True)
    ca_type               = Column(Enum(CAType), default=CAType.unknown)

    subject_organization       = Column(String(255), nullable=True)
    subject_organizational_unit= Column(String(255), nullable=True)
    subject_country            = Column(String(2), nullable=True)
    subject_state              = Column(String(100), nullable=True)
    subject_locality           = Column(String(100), nullable=True)

    key_type              = Column(Enum(KeyType), default=KeyType.rsa_2048)
    signature_algorithm   = Column(String(100), nullable=True)
    wildcard              = Column(Boolean, default=False)
    key_usages            = Column(JSON, nullable=True)
    extended_key_usages   = Column(JSON, nullable=True)
    ocsp_url              = Column(String(500), nullable=True)
    crl_url               = Column(String(500), nullable=True)
    ca_issuers_url        = Column(String(500), nullable=True)
    is_ca                 = Column(Boolean, default=False)
    chain_valid           = Column(Boolean, nullable=True)

    auto_renew            = Column(Boolean, default=False)
    managed_by            = Column(String(100), nullable=True)
    acme_account          = Column(String(255), nullable=True)
    environment           = Column(Enum(CertEnvironment), default=CertEnvironment.production)
    notes                 = Column(Text, nullable=True)

    source                = Column(String(100), nullable=True)
    last_verified_at      = Column(DateTime(timezone=True), nullable=True)
    created_at            = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at            = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc),
                                   onupdate=lambda: datetime.now(timezone.utc))

    @property
    def cert_status(self):
        if not self.expires_at: return "unknown"
        delta = (self.expires_at - date.today()).days
        if delta < 0:    return "expired"
        if delta <= 7:   return "critical"
        if delta <= 30:  return "expiring"
        return "valid"

    @property
    def days_remaining(self):
        if not self.expires_at: return None
        return (self.expires_at - date.today()).days

    def to_dict(self):
        return {
            "id": self.id,
            "common_name": self.common_name,
            "san_domains": self.san_domains or [],
            "serial_number": self.serial_number,
            "fingerprint_sha256": self.fingerprint_sha256,
            "fingerprint_sha1": self.fingerprint_sha1,
            "issued_at": self.issued_at.isoformat() if self.issued_at else None,
            "expires_at": self.expires_at.isoformat() if self.expires_at else None,
            "not_before": self.not_before.isoformat() if self.not_before else None,
            "issuer": self.issuer,
            "issuer_common_name": self.issuer_common_name,
            "issuer_organization": self.issuer_organization,
            "issuer_country": self.issuer_country,
            "ca_type": str(self.ca_type).split(".")[-1] if self.ca_type else "unknown",
            "subject_organization": self.subject_organization,
            "subject_organizational_unit": self.subject_organizational_unit,
            "subject_country": self.subject_country,
            "subject_state": self.subject_state,
            "subject_locality": self.subject_locality,
            "key_type": str(self.key_type).split(".")[-1] if self.key_type else "rsa_2048",
            "signature_algorithm": self.signature_algorithm,
            "wildcard": self.wildcard,
            "key_usages": self.key_usages,
            "extended_key_usages": self.extended_key_usages,
            "ocsp_url": self.ocsp_url,
            "crl_url": self.crl_url,
            "chain_valid": self.chain_valid,
            "auto_renew": self.auto_renew,
            "managed_by": self.managed_by,
            "acme_account": self.acme_account,
            "environment": str(self.environment).split(".")[-1] if self.environment else "production",
            "notes": self.notes,
            "source": self.source,
            "last_verified_at": self.last_verified_at.isoformat() if self.last_verified_at else None,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
            "cert_status": self.cert_status,
            "days_remaining": self.days_remaining,
        }
