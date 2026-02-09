"""Credential sharing model for team collaboration."""

import enum
from datetime import datetime
from uuid import uuid4

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class SharePermission(str, enum.Enum):
    """Permission levels for shared credentials."""

    READ_ONLY = "read_only"
    READ_WRITE = "read_write"


class CredentialShare(Base):
    """Tracks credential sharing between users."""

    __tablename__ = "credential_shares"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        primary_key=True,
        default=lambda: str(uuid4()),
    )

    # The credential being shared
    credential_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("credentials.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Who shared it
    shared_by_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )

    # Who it's shared with
    shared_with_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Encrypted data for the recipient (re-encrypted with their key)
    encrypted_data: Mapped[str] = mapped_column(Text, nullable=False)

    # Permission level
    permission: Mapped[SharePermission] = mapped_column(
        Enum(SharePermission),
        default=SharePermission.READ_ONLY,
        nullable=False,
    )

    # Status
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    accepted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    revoked_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # Timestamps
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    # Relationships
    credential: Mapped["Credential"] = relationship("Credential", backref="shares")
    shared_by: Mapped["User"] = relationship("User", foreign_keys=[shared_by_id])
    shared_with: Mapped["User"] = relationship("User", foreign_keys=[shared_with_id])

    def __repr__(self) -> str:
        return f"<CredentialShare {self.credential_id} -> {self.shared_with_id}>"
