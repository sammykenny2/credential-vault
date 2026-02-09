"""WebAuthn credential model for passkey/security key storage."""

from datetime import datetime
from uuid import uuid4

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, LargeBinary, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class WebAuthnCredential(Base):
    """Stores WebAuthn/FIDO2 credentials for passkey authentication."""

    __tablename__ = "webauthn_credentials"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        primary_key=True,
        default=lambda: str(uuid4()),
    )

    # Owner
    user_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # WebAuthn credential data
    credential_id: Mapped[bytes] = mapped_column(LargeBinary, nullable=False, unique=True)
    public_key: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    sign_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    # Metadata
    device_name: Mapped[str] = mapped_column(String(255), nullable=False, default="Security Key")
    aaguid: Mapped[str | None] = mapped_column(String(36), nullable=True)

    # Credential type info
    credential_type: Mapped[str] = mapped_column(String(50), default="public-key", nullable=False)
    transports: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Status
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    # Timestamps
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Relationships
    user: Mapped["User"] = relationship("User", backref="webauthn_credentials")

    def __repr__(self) -> str:
        return f"<WebAuthnCredential {self.device_name} for {self.user_id}>"
