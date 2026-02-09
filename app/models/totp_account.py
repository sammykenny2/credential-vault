"""TOTP account model for built-in authenticator.

Allows the vault to act as a TOTP authenticator (like Google Authenticator),
storing TOTP secrets and generating codes for external services.
"""

from datetime import datetime
from uuid import uuid4

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class TOTPAccount(Base):
    """Stores TOTP secrets for external services (built-in authenticator)."""

    __tablename__ = "totp_accounts"

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

    # TOTP configuration
    encrypted_secret: Mapped[str] = mapped_column(Text, nullable=False)
    issuer: Mapped[str] = mapped_column(String(255), nullable=False)
    account_name: Mapped[str] = mapped_column(String(255), nullable=False)

    # TOTP parameters
    algorithm: Mapped[str] = mapped_column(String(10), default="SHA1", nullable=False)
    digits: Mapped[int] = mapped_column(Integer, default=6, nullable=False)
    period: Mapped[int] = mapped_column(Integer, default=30, nullable=False)

    # Optional link to a credential
    credential_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("credentials.id", ondelete="SET NULL"),
        nullable=True,
    )

    # Display
    icon: Mapped[str | None] = mapped_column(String(50), nullable=True)

    # Timestamps
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    # Relationships
    user: Mapped["User"] = relationship("User", backref="totp_accounts")
    credential: Mapped["Credential"] = relationship("Credential", backref="totp_accounts")

    def __repr__(self) -> str:
        return f"<TOTPAccount {self.issuer}:{self.account_name}>"
