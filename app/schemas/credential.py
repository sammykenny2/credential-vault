"""Credential schemas."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class CredentialData(BaseModel):
    """Decrypted credential data (client-side).

    Pure key-value storage - all fields are dynamic.
    """

    fields: dict[str, str] = {}
    notes: str | None = None


class CredentialBase(BaseModel):
    """Base credential schema (metadata only)."""

    name: str = Field(min_length=1, max_length=255)
    description: str | None = Field(None, max_length=1000)
    website_url: str | None = Field(None, max_length=2048)
    category: str | None = Field(None, max_length=100)


class CredentialCreate(CredentialBase):
    """Credential creation schema."""

    # Encrypted data from client
    encrypted_data: str


class CredentialUpdate(BaseModel):
    """Credential update schema."""

    name: str | None = Field(None, min_length=1, max_length=255)
    description: str | None = Field(None, max_length=1000)
    website_url: str | None = Field(None, max_length=2048)
    category: str | None = Field(None, max_length=100)
    encrypted_data: str | None = None


class CredentialRead(CredentialBase):
    """Credential read schema."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    owner_id: str
    encrypted_data: str
    is_active: bool
    revoked_at: datetime | None
    created_at: datetime
    updated_at: datetime


class CredentialListItem(BaseModel):
    """Credential list item (metadata only, no encrypted data)."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    description: str | None
    website_url: str | None
    category: str | None
    is_active: bool
    created_at: datetime
    updated_at: datetime
