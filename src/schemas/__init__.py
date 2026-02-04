"""Pydantic schemas for API request/response validation."""

from src.schemas.auth import MFASetup, MFAVerify, Token, TokenPayload
from src.schemas.credential import (
    CredentialCreate,
    CredentialData,
    CredentialRead,
    CredentialUpdate,
)
from src.schemas.template import (
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
from src.schemas.user import UserCreate, UserRead, UserUpdate

__all__ = [
    # Auth
    "Token",
    "TokenPayload",
    "MFASetup",
    "MFAVerify",
    # User
    "UserCreate",
    "UserRead",
    "UserUpdate",
    # Credential
    "CredentialCreate",
    "CredentialRead",
    "CredentialUpdate",
    "CredentialData",
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
