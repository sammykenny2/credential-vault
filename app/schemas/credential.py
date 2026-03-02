"""Credential schemas.

All metadata (name, description, etc.) is stored inside the encrypted_data blob.
The server only sees opaque encrypted data.
"""

from datetime import datetime

from pydantic import BaseModel, ConfigDict


class CredentialCreate(BaseModel):
    """Credential creation schema."""

    encrypted_data: str
    expires_at: datetime | None = None


class CredentialUpdate(BaseModel):
    """Credential update schema."""

    encrypted_data: str | None = None
    expires_at: datetime | None = None


class CredentialRead(BaseModel):
    """Credential read schema."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    owner_id: str
    encrypted_data: str
    is_active: bool
    expires_at: datetime | None
    revoked_at: datetime | None
    created_at: datetime
    updated_at: datetime


class CredentialListItem(BaseModel):
    """Credential list item (includes encrypted_data for client-side search/display)."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    encrypted_data: str
    is_active: bool
    expires_at: datetime | None
    created_at: datetime
    updated_at: datetime


class CredentialExport(BaseModel):
    """Schema for credential export."""

    encrypted_data: str
    expires_at: datetime | None = None


class CredentialImportRequest(BaseModel):
    """Schema for importing credentials."""

    credentials: list[CredentialExport]
    format: str = "json"


class CredentialImportResult(BaseModel):
    """Result of credential import."""

    imported: int
    skipped: int
    errors: list[str]
