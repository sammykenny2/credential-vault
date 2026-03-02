"""Credential model."""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING
from uuid import uuid4

from sqlalchemy import Boolean, DateTime, ForeignKey, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin

if TYPE_CHECKING:
    from app.models.user import User


class Credential(Base, TimestampMixin):
    """Encrypted credential storage model.

    All metadata (name, description, website_url, category) is stored
    inside the encrypted_data blob. The server cannot read any credential content.
    """

    __tablename__ = "credentials"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        primary_key=True,
        default=lambda: str(uuid4()),
    )

    # Ownership
    owner_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Encrypted data (contains all credential fields + metadata as encrypted JSON)
    encrypted_data: Mapped[str] = mapped_column(Text, nullable=False)

    # Expiration (optional - for API keys, certificates, etc.)
    expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        index=True,
    )

    # Status
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    # Relationships
    owner: Mapped[User] = relationship("User", back_populates="credentials")

    def __repr__(self) -> str:
        return f"<Credential {self.id}>"
