"""WebAuthn/Passkey endpoints."""

from fastapi import APIRouter, HTTPException, status

from app.api.deps import CurrentUser, DbSession
from app.schemas.webauthn import (
    WebAuthnCredentialRead,
    WebAuthnRegistrationOptionsRequest,
    WebAuthnRegistrationResponse,
)
from app.services.webauthn_service import WebAuthnService

router = APIRouter()


@router.post("/register/options")
async def get_registration_options(
    data: WebAuthnRegistrationOptionsRequest,
    current_user: CurrentUser,
    db: DbSession,
):
    """Get WebAuthn registration options for creating a new passkey."""
    service = WebAuthnService(db)
    return await service.generate_registration_options(
        user_id=current_user.id,
        user_email=current_user.email,
    )


@router.post("/register/complete")
async def complete_registration(
    data: WebAuthnRegistrationResponse,
    current_user: CurrentUser,
    db: DbSession,
):
    """Complete WebAuthn registration with credential data from the client."""
    service = WebAuthnService(db)
    try:
        credential = await service.register_credential(
            user_id=current_user.id,
            device_name=data.device_name,
            credential_id_b64=data.credential_id,
            public_key_b64=data.public_key,
            transports=data.transports,
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )

    return {
        "id": credential.id,
        "device_name": credential.device_name,
        "created_at": credential.created_at.isoformat(),
    }


@router.post("/authenticate/options")
async def get_authentication_options(
    current_user: CurrentUser,
    db: DbSession,
):
    """Get WebAuthn authentication options."""
    service = WebAuthnService(db)
    try:
        return await service.generate_authentication_options(current_user.id)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )


@router.get("/credentials", response_model=list[WebAuthnCredentialRead])
async def list_webauthn_credentials(
    current_user: CurrentUser,
    db: DbSession,
):
    """List registered WebAuthn credentials."""
    service = WebAuthnService(db)
    return await service.list_credentials(current_user.id)


@router.delete("/credentials/{credential_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_webauthn_credential(
    credential_id: str,
    current_user: CurrentUser,
    db: DbSession,
):
    """Delete a WebAuthn credential."""
    service = WebAuthnService(db)
    success = await service.delete_credential(credential_id, current_user.id)
    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="WebAuthn credential not found",
        )
