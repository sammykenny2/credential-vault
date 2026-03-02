"""Pydantic schemas for API request/response validation."""

from app.schemas.auth import (
    GoogleOAuthCallback,
    LocalLoginRequest,
    Token,
    TokenPayload,
    VaultSetupRequest,
)
from app.schemas.credential import (
    CredentialCreate,
    CredentialRead,
    CredentialUpdate,
)
from app.schemas.template import (
    RecordUsageRequest,
    RecordUsageResponse,
    SyncRequest,
    SyncResponse,
    TemplateCreate,
    TemplateField,
    TemplateListItem,
    TemplateListResponse,
    TemplateRead,
    TemplateUpdate,
    TemplateUsageResponse,
    TemplateUsageStats,
    VersionConflictResponse,
)
from app.schemas.user import UserCreate, UserRead, UserUpdate

__all__ = [
    # Auth
    "Token",
    "TokenPayload",
    "GoogleOAuthCallback",
    "LocalLoginRequest",
    "VaultSetupRequest",
    # User
    "UserCreate",
    "UserRead",
    "UserUpdate",
    # Credential
    "CredentialCreate",
    "CredentialRead",
    "CredentialUpdate",
    # Template
    "TemplateField",
    "TemplateCreate",
    "TemplateUpdate",
    "TemplateRead",
    "TemplateListItem",
    "TemplateListResponse",
    "TemplateUsageStats",
    "TemplateUsageResponse",
    "RecordUsageRequest",
    "RecordUsageResponse",
    "SyncRequest",
    "SyncResponse",
    "VersionConflictResponse",
]
