"""Built-in TOTP authenticator endpoints."""

from fastapi import APIRouter, HTTPException, status

from app.api.deps import CurrentUser, DbSession
from app.core.crypto import decrypt_string
from app.schemas.totp import TOTPAccountCreate, TOTPAccountRead, TOTPAccountUpdate, TOTPCodeResponse
from app.services.totp_service import TOTPService

router = APIRouter()


@router.get("/", response_model=list[TOTPAccountRead])
async def list_totp_accounts(
    current_user: CurrentUser,
    db: DbSession,
):
    """List all TOTP accounts."""
    service = TOTPService(db)
    return await service.list_accounts(current_user.id)


@router.post("/", response_model=TOTPAccountRead, status_code=status.HTTP_201_CREATED)
async def create_totp_account(
    data: TOTPAccountCreate,
    current_user: CurrentUser,
    db: DbSession,
):
    """Add a new TOTP account to the authenticator."""
    service = TOTPService(db)
    return await service.create_account(current_user.id, data)


@router.get("/{account_id}", response_model=TOTPAccountRead)
async def get_totp_account(
    account_id: str,
    current_user: CurrentUser,
    db: DbSession,
):
    """Get a TOTP account."""
    service = TOTPService(db)
    account = await service.get_account(account_id, current_user.id)
    if not account:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="TOTP account not found",
        )
    return account


@router.post("/{account_id}/code", response_model=TOTPCodeResponse)
async def generate_totp_code(
    account_id: str,
    current_user: CurrentUser,
    db: DbSession,
):
    """Generate current TOTP code for an account."""
    service = TOTPService(db)
    account = await service.get_account(account_id, current_user.id)
    if not account:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="TOTP account not found",
        )

    try:
        # Decrypt the secret
        secret = decrypt_string(account.encrypted_secret)
        result = TOTPService.generate_code(
            secret=secret,
            algorithm=account.algorithm,
            digits=account.digits,
            period=account.period,
        )
        return TOTPCodeResponse(**result)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to generate TOTP code: {str(e)}",
        )


@router.patch("/{account_id}", response_model=TOTPAccountRead)
async def update_totp_account(
    account_id: str,
    data: TOTPAccountUpdate,
    current_user: CurrentUser,
    db: DbSession,
):
    """Update a TOTP account."""
    service = TOTPService(db)
    account = await service.update_account(account_id, current_user.id, data)
    if not account:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="TOTP account not found",
        )
    return account


@router.delete("/{account_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_totp_account(
    account_id: str,
    current_user: CurrentUser,
    db: DbSession,
):
    """Delete a TOTP account."""
    service = TOTPService(db)
    success = await service.delete_account(account_id, current_user.id)
    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="TOTP account not found",
        )
