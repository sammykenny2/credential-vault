"""API dependencies for authentication and database access."""

from typing import Annotated

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.core.security import SecurityService
from app.core.vault_proof import VAULT_PROOF_HEADER, verify_signed_proof, verify_upgrade_proof
from app.db.session import get_db
from app.models.user import User, UserRole
from app.services.user import UserService

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/oauth/google/callback")


async def get_current_user(
    token: Annotated[str, Depends(oauth2_scheme)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> User:
    """Get current authenticated user from JWT token."""
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )

    payload = SecurityService.decode_token(token)
    if payload is None:
        raise credentials_exception

    if payload.get("type") != "access":
        raise credentials_exception

    user_id = payload.get("sub")
    if user_id is None:
        raise credentials_exception

    user_service = UserService(db)
    user = await user_service.get_by_id(user_id)

    if user is None:
        raise credentials_exception

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User account is deactivated",
        )

    # Logout bumps token_version; anything issued before that is revoked.
    if payload.get("ver", 0) != user.token_version:
        raise credentials_exception

    return user


async def get_current_active_user(
    current_user: Annotated[User, Depends(get_current_user)],
) -> User:
    """Ensure current user is active."""
    if not current_user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Inactive user",
        )
    return current_user


# The frontend matches this to offer signing in again, so keep it stable. It is a
# 403, not a 401: a 401 would make the client refresh, which cannot help.
RECENT_LOGIN_REQUIRED = "recent_login_required"


async def get_recently_signed_in_user(
    token: Annotated[str, Depends(oauth2_scheme)],
    current_user: Annotated[User, Depends(get_current_active_user)],
) -> User:
    """Ensure this session signed in recently, for actions a stale token must not take."""
    payload = SecurityService.decode_token(token)
    if payload is None or not SecurityService.is_recent_login(payload):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=RECENT_LOGIN_REQUIRED,
        )
    return current_user


async def get_current_admin_user(
    current_user: Annotated[User, Depends(get_current_active_user)],
) -> User:
    """Ensure current user is an admin."""
    if current_user.role != UserRole.ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required",
        )
    return current_user


def ensure_vault_proof(request: Request, user: User) -> None:
    """Raise 403 unless the request carries a valid X-Vault-Proof for this user.

    A session token alone must not be enough to change vault data; the client
    proves it holds the unlocked vault key by answering a challenge from
    POST /auth/vault/challenge. Only proof v2 counts here: a vault that has not
    been upgraded must upgrade first, which unlocking does.
    """
    if not user.signing_public_key or not verify_signed_proof(
        request.headers.get(VAULT_PROOF_HEADER),
        user.id,
        user.token_version,
        get_settings().secret_key,
        user.signing_public_key,
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Vault proof required: unlock the vault and retry this action",
        )


async def get_vault_proven_user(
    request: Request,
    current_user: Annotated[User, Depends(get_current_active_user)],
) -> User:
    """Current user, additionally proven to hold the unlocked vault key."""
    ensure_vault_proof(request, current_user)
    return current_user


async def get_vault_upgrading_user(
    request: Request,
    current_user: Annotated[User, Depends(get_current_active_user)],
) -> User:
    """Current user proven to hold the RSA key: proof v1, for POST /auth/vault/upgrade only."""
    if not verify_upgrade_proof(
        request.headers.get(VAULT_PROOF_HEADER),
        current_user.id,
        current_user.token_version,
        get_settings().secret_key,
        current_user.vault_proof_key,
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Vault proof required: unlock the vault and retry this action",
        )
    return current_user


async def get_vault_signing_user(
    request: Request,
    current_user: Annotated[User, Depends(get_current_active_user)],
) -> User:
    """Current user with a signed vault, proven to hold the unlocked signing key.

    Every credential write goes through this: browsers refuse unsigned records,
    so storing one for a vault that cannot sign would only hide data.
    """
    if not current_user.signing_public_key:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Vault upgrade required: unlock the vault to finish the upgrade",
        )
    ensure_vault_proof(request, current_user)
    return current_user


async def get_vault_proven_admin_user(
    request: Request,
    admin_user: Annotated[User, Depends(get_current_admin_user)],
) -> User:
    """Admin, additionally proven to hold the unlocked vault key.

    Required for changes to accounts: with a session token alone, a stolen
    admin token could promote or reactivate an account and keep admin access.
    """
    ensure_vault_proof(request, admin_user)
    return admin_user


# Type aliases for cleaner dependency injection
CurrentUser = Annotated[User, Depends(get_current_active_user)]
RecentlySignedInUser = Annotated[User, Depends(get_recently_signed_in_user)]
AdminUser = Annotated[User, Depends(get_current_admin_user)]
VaultProvenUser = Annotated[User, Depends(get_vault_proven_user)]
VaultSigningUser = Annotated[User, Depends(get_vault_signing_user)]
VaultUpgradingUser = Annotated[User, Depends(get_vault_upgrading_user)]
VaultProvenAdmin = Annotated[User, Depends(get_vault_proven_admin_user)]
DbSession = Annotated[AsyncSession, Depends(get_db)]
