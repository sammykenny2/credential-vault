"""Audit log model for tracking sensitive operations."""

import enum
from datetime import datetime
from uuid import uuid4

from sqlalchemy import DateTime, Enum, ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class AuditAction(enum.StrEnum):
    """Audit log action types."""

    # Auth
    LOGIN_SUCCESS = "login_success"
    LOGIN_FAILURE = "login_failure"
    LOGOUT = "logout"
    TOKEN_REFRESH = "token_refresh"
    OAUTH_LOGIN = "oauth_login"

    # Vault
    VAULT_SETUP = "vault_setup"
    VAULT_UNLOCK = "vault_unlock"

    # Credential
    CREDENTIAL_CREATED = "credential_created"
    CREDENTIAL_READ = "credential_read"
    CREDENTIAL_UPDATED = "credential_updated"
    CREDENTIAL_REVOKED = "credential_revoked"
    CREDENTIAL_DELETED = "credential_deleted"

    # WebAuthn
    WEBAUTHN_REGISTERED = "webauthn_registered"
    WEBAUTHN_AUTHENTICATED = "webauthn_authenticated"

    # User management (admin)
    USER_CREATED = "user_created"
    USER_UPDATED = "user_updated"
    USER_DEACTIVATED = "user_deactivated"
    USER_REACTIVATED = "user_reactivated"
    USER_DELETED = "user_deleted"
    USER_ROLE_CHANGED = "user_role_changed"
    GOOGLE_ACCOUNT_LINKED = "google_account_linked"


class AuditLog(Base):
    """Audit log for tracking all sensitive operations."""

    __tablename__ = "audit_logs"

    id: Mapped[str] = mapped_column(
        String(36),
        primary_key=True,
        default=lambda: str(uuid4()),
    )

    # Who performed the action
    user_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    # What action was performed
    action: Mapped[AuditAction] = mapped_column(
        Enum(AuditAction),
        nullable=False,
        index=True,
    )

    # Target resource (e.g., credential ID, user ID)
    resource_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    resource_id: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Additional context (JSON-serializable details, no sensitive data)
    details: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Request metadata
    ip_address: Mapped[str | None] = mapped_column(String(45), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String(500), nullable=True)

    # Timestamp
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
        index=True,
    )

    def __repr__(self) -> str:
        return f"<AuditLog {self.action} by {self.user_id}>"
