"""Credential schemas.

All metadata (name, description, etc.) is stored inside the encrypted_data blob.
The server only sees opaque encrypted data.

Every write carries the browser's ECDSA signature over the ciphertext hash, the
revision and the status columns (ADR-004). The server stores the signature
without interpreting it; browsers verify it on read, before decrypting.
"""

from datetime import UTC, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

# 64 raw bytes (r||s) in standard base64.
SIGNATURE_PATTERN = r"^[A-Za-z0-9+/]{86}==$"

RecordOrigin = Literal["authored", "legacy-unverified"]


def _as_utc(value: datetime | None) -> datetime | None:
    """Store instants in UTC: SQLite drops the offset, and the signature covers the instant."""
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


class SignedRecordFields(BaseModel):
    """Signed state sent with every credential write."""

    revision: int = Field(ge=1)
    signature: str = Field(pattern=SIGNATURE_PATTERN)
    signature_version: Literal[1] = 1
    origin: RecordOrigin


class CredentialCreate(SignedRecordFields):
    """Credential creation schema.

    The client chooses the id because the ciphertext and the signature are both
    bound to it. A new record always starts at revision 1.
    """

    id: UUID
    encrypted_data: str = Field(min_length=1, max_length=1_000_000)
    expires_at: datetime | None = None
    revision: Literal[1] = 1

    _utc_expires_at = field_validator("expires_at")(_as_utc)


class CredentialUpdate(SignedRecordFields):
    """Credential update schema. `revision` must be the current revision plus one."""

    encrypted_data: str | None = Field(None, min_length=1, max_length=1_000_000)
    expires_at: datetime | None = None

    _utc_expires_at = field_validator("expires_at")(_as_utc)


class CredentialRevoke(SignedRecordFields):
    """Revocation. The client sets `revoked_at` because the signature covers it."""

    revoked_at: datetime

    _utc_revoked_at = field_validator("revoked_at")(_as_utc)


class CredentialRead(BaseModel):
    """Credential read schema."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    owner_id: str
    encrypted_data: str
    is_active: bool
    expires_at: datetime | None
    revoked_at: datetime | None
    revision: int
    signature: str | None
    signature_version: int | None
    origin: str | None
    created_at: datetime
    updated_at: datetime


class CredentialListItem(BaseModel):
    """Credential list item (includes encrypted_data for client-side search/display)."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    encrypted_data: str
    is_active: bool
    expires_at: datetime | None
    revoked_at: datetime | None
    revision: int
    signature: str | None
    signature_version: int | None
    origin: str | None
    created_at: datetime
    updated_at: datetime


class CredentialExport(SignedRecordFields):
    """One record of an import: a new record, signed at revision 1."""

    id: UUID
    encrypted_data: str = Field(min_length=1, max_length=1_000_000)
    expires_at: datetime | None = None
    is_active: bool = True
    revoked_at: datetime | None = None
    revision: Literal[1] = 1

    _utc_expires_at = field_validator("expires_at")(_as_utc)
    _utc_revoked_at = field_validator("revoked_at")(_as_utc)

    @model_validator(mode="after")
    def _consistent_status(self) -> CredentialExport:
        if self.is_active != (self.revoked_at is None):
            raise ValueError("Active and revoked status must agree")
        return self


class CredentialImportRequest(BaseModel):
    """Schema for importing credentials."""

    credentials: list[CredentialExport] = Field(max_length=500)
    format: str = "json"


class CredentialImportResult(BaseModel):
    """Result of credential import."""

    imported: int
    skipped: int
    errors: list[str]


class RecordAdoption(BaseModel):
    """A signature over an existing record, made during the one-time vault upgrade."""

    id: UUID
    revision: int = Field(ge=2)
    signature: str = Field(pattern=SIGNATURE_PATTERN)
    signature_version: Literal[1] = 1
    origin: Literal["legacy-unverified"] = "legacy-unverified"
