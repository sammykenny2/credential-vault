"""Emergency access model.

Allows users to designate trusted contacts who can request access
to their vault after a configurable waiting period.
"""

import enum
from datetime import datetime
from uuid import uuid4

from sqlalchemy import DateTime, Enum, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class EmergencyStatus(str, enum.Enum):
    """Status of an emergency access grant."""

    INVITED = "invited"
    ACCEPTED = "accepted"
    RECOVERY_INITIATED = "recovery_initiated"
    RECOVERY_APPROVED = "recovery_approved"
    RECOVERY_REJECTED = "recovery_rejected"
    REVOKED = "revoked"


class EmergencyAccess(Base):
    """Emergency access configuration between grantor and grantee."""

    __tablename__ = "emergency_access"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        primary_key=True,
        default=lambda: str(uuid4()),
    )

    # The user granting emergency access (vault owner)
    grantor_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # The trusted contact who can request access
    grantee_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Current status
    status: Mapped[EmergencyStatus] = mapped_column(
        Enum(EmergencyStatus),
        default=EmergencyStatus.INVITED,
        nullable=False,
    )

    # Waiting period in days before auto-approval
    wait_time_days: Mapped[int] = mapped_column(
        Integer,
        default=7,
        nullable=False,
    )

    # When recovery was initiated
    recovery_initiated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # When the waiting period ends (auto-approve after this)
    recovery_deadline: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # Encrypted key material for the grantee (set when approved)
    encrypted_key: Mapped[str | None] = mapped_column(Text, nullable=True)

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
    grantor: Mapped["User"] = relationship("User", foreign_keys=[grantor_id])
    grantee: Mapped["User"] = relationship("User", foreign_keys=[grantee_id])

    def __repr__(self) -> str:
        return f"<EmergencyAccess {self.grantor_id} -> {self.grantee_id} ({self.status})>"
