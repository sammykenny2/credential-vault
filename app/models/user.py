"""User model."""

from __future__ import annotations

import enum
from datetime import datetime
from typing import TYPE_CHECKING
from uuid import uuid4

from sqlalchemy import Boolean, DateTime, Enum, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin

if TYPE_CHECKING:
    from app.models.credential import Credential
    from app.models.template import Template
    from app.models.template_usage import TemplateUsage


class UserRole(enum.StrEnum):
    """User roles for access control."""

    USER = "user"
    ADMIN = "admin"


class User(Base, TimestampMixin):
    """User account model."""

    __tablename__ = "users"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        primary_key=True,
        default=lambda: str(uuid4()),
    )
    email: Mapped[str] = mapped_column(
        String(255),
        unique=True,
        index=True,
        nullable=False,
    )
    display_name: Mapped[str] = mapped_column(String(100), nullable=False)

    # Google OAuth identity
    google_id: Mapped[str | None] = mapped_column(
        String(255),
        unique=True,
        nullable=True,
        index=True,
    )

    # Legacy password (nullable for OAuth-only users)
    hashed_password: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # E2EE key material
    public_key: Mapped[str | None] = mapped_column(Text, nullable=True)
    encrypted_private_key: Mapped[str | None] = mapped_column(Text, nullable=True)
    key_salt: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Role
    role: Mapped[UserRole] = mapped_column(
        Enum(UserRole),
        default=UserRole.USER,
        nullable=False,
    )

    # Status
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    last_login_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    # Relationships
    credentials: Mapped[list[Credential]] = relationship(
        "Credential",
        back_populates="owner",
        cascade="all, delete-orphan",
    )
    templates: Mapped[list[Template]] = relationship(
        "Template",
        back_populates="owner",
        cascade="all, delete-orphan",
    )
    template_usage: Mapped[list[TemplateUsage]] = relationship(
        "TemplateUsage",
        back_populates="user",
        cascade="all, delete-orphan",
    )

    @property
    def has_vault_keys(self) -> bool:
        """Check if user has set up E2EE vault keys."""
        return self.public_key is not None and self.encrypted_private_key is not None

    def __repr__(self) -> str:
        return f"<User {self.email}>"
