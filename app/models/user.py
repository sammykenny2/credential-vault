"""User model."""

from __future__ import annotations

import enum
from datetime import datetime
from typing import TYPE_CHECKING
from uuid import uuid4

from sqlalchemy import Boolean, DateTime, Enum, Integer, String, Text
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
        String(36),
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
    # Which client-side KDF parameters wrapped the private key (2 = Argon2id
    # 64 MiB / 3 iterations). Lets the parameters change without guessing.
    kdf_version: Mapped[int] = mapped_column(
        Integer,
        default=2,
        server_default="2",
        nullable=False,
    )

    # Role
    role: Mapped[UserRole] = mapped_column(
        Enum(UserRole),
        default=UserRole.USER,
        nullable=False,
    )

    # Status
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    # Session revocation: every issued JWT carries this value as `ver`.
    # Logout increments it, which invalidates all outstanding tokens.
    token_version: Mapped[int] = mapped_column(
        Integer,
        default=0,
        server_default="0",
        nullable=False,
    )

    # Proof of unlock: sha256 of the last challenge secret the client must
    # decrypt with the vault private key before deleting or overwriting data.
    vault_proof_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    vault_proof_expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
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

    @property
    def has_google_linked(self) -> bool:
        """Check if user has a real Google account linked (not a setup placeholder)."""
        return self.google_id is not None and not self.google_id.startswith("setup-")

    def __repr__(self) -> str:
        return f"<User {self.email}>"
