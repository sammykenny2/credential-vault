"""Template model for credential templates."""

from __future__ import annotations

from typing import TYPE_CHECKING
from uuid import uuid4

from sqlalchemy import JSON, Boolean, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin

if TYPE_CHECKING:
    from app.models.template_usage import TemplateUsage
    from app.models.user import User


class Template(Base, TimestampMixin):
    """User-defined credential template model.

    Templates define field structures for credentials.
    Each user can have their own custom templates.
    Built-in templates are stored in the frontend, not in this table.
    """

    __tablename__ = "templates"

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

    # Metadata
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    icon: Mapped[str | None] = mapped_column(String(50), nullable=True)  # Emoji or icon name
    category: Mapped[str | None] = mapped_column(String(50), nullable=True, index=True)

    # Fields definition (JSONB array of TemplateField)
    # Structure: [{"key": "username", "isSecret": false, "required": true}, ...]
    fields: Mapped[dict] = mapped_column(JSON, nullable=False)

    # Sync & Status
    sync_version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    # Relationships
    owner: Mapped[User] = relationship("User", back_populates="templates")
    usage_records: Mapped[list[TemplateUsage]] = relationship(
        "TemplateUsage",
        back_populates="template",
        cascade="all, delete-orphan",
    )

    # Constraints
    __table_args__ = (UniqueConstraint("owner_id", "name", name="uq_template_owner_name"),)

    def __repr__(self) -> str:
        return f"<Template {self.name}>"
