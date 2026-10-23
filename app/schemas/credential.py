"""Credential schemas.

All metadata (name, description, etc.) is stored inside the encrypted_data blob.
The server only sees opaque encrypted data.
"""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class CredentialCreate(BaseModel):
    """Credential creation schema.

    The client may choose the id so it can bind the ciphertext to it (AES-GCM
    additional data). A server-chosen id is used when none is supplied.
    """

    id: UUID | None = None
    encrypted_data: str = Field(min_length=1, max_length=1_000_000)
    expires_at: datetime | None = None


class CredentialUpdate(BaseModel):
    """Credential update schema."""

    encrypted_data: str | None = Field(None, min_length=1, max_length=1_000_000)
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
    """Schema for credential export/import (id keeps v2 blobs decryptable)."""

    id: UUID | None = None
    encrypted_data: str = Field(min_length=1, max_length=1_000_000)
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
