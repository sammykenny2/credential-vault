"""Schemas for WebAuthn / Passkey support."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class WebAuthnRegistrationOptionsRequest(BaseModel):
    """Request registration options."""

    device_name: str = Field("Security Key", max_length=255)


class WebAuthnRegistrationResponse(BaseModel):
    """Registration response from the client."""

    device_name: str
    credential_id: str  # base64url encoded
    public_key: str  # base64url encoded
    attestation_object: str  # base64url encoded
    client_data_json: str  # base64url encoded
    transports: list[str] = []


class WebAuthnCredentialRead(BaseModel):
    """WebAuthn credential read schema."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    device_name: str
    credential_type: str
    is_active: bool
    created_at: datetime
    last_used_at: datetime | None


class WebAuthnAuthenticationRequest(BaseModel):
    """Authentication request from the client."""

    credential_id: str  # base64url encoded
    authenticator_data: str  # base64url encoded
    client_data_json: str  # base64url encoded
    signature: str  # base64url encoded


class WebAuthnDeleteRequest(BaseModel):
    """Request to delete a WebAuthn credential."""

    credential_id: str
