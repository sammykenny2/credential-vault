"""Template usage tracking model."""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING
from uuid import uuid4

from sqlalchemy import DateTime, ForeignKey, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base

if TYPE_CHECKING:
    from app.models.credential import Credential
    from app.models.template import Template
    from app.models.user import User


class TemplateUsage(Base):
    """Tracks when templates are used to create credentials.

    This enables usage-based sorting and statistics.
    """

    __tablename__ = "template_usage"

    id: Mapped[str] = mapped_column(
        String(36),
        primary_key=True,
        default=lambda: str(uuid4()),
    )

    # References
    template_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("templates.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    credential_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey("credentials.id", ondelete="SET NULL"),
        nullable=True,
    )

    # Timestamp
    used_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    # Relationships
    template: Mapped[Template] = relationship("Template", back_populates="usage_records")
    user: Mapped[User] = relationship("User", back_populates="template_usage")
    credential: Mapped[Credential | None] = relationship("Credential")

    # Constraints - prevent duplicate usage records for the same credential
    __table_args__ = (
        UniqueConstraint("template_id", "credential_id", name="uq_template_credential_usage"),
    )

    def __repr__(self) -> str:
        return f"<TemplateUsage template={self.template_id} at {self.used_at}>"
