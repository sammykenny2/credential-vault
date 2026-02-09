"""Schemas for credential sharing."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.models.credential_share import SharePermission


class ShareCreate(BaseModel):
    """Request to share a credential."""

    credential_id: str
    shared_with_email: str
    encrypted_data: str
    permission: SharePermission = SharePermission.READ_ONLY


class ShareRead(BaseModel):
    """Shared credential read schema."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    credential_id: str
    shared_by_id: str
    shared_with_id: str
    permission: SharePermission
    is_active: bool
    created_at: datetime
    accepted_at: datetime | None

    # Display fields
    credential_name: str = ""
    shared_by_email: str = ""
    shared_with_email: str = ""


class ShareUpdate(BaseModel):
    """Update sharing permissions."""

    permission: SharePermission | None = None
    is_active: bool | None = None


class SharedCredentialRead(BaseModel):
    """A credential shared with the current user."""

    share_id: str
    credential_id: str
    credential_name: str
    description: str | None
    category: str | None
    encrypted_data: str
    permission: SharePermission
    shared_by_email: str
    shared_at: datetime
