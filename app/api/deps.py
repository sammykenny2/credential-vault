"""API dependencies for authentication and database access."""

from typing import Annotated

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import SecurityService
from app.core.vault_proof import VAULT_PROOF_HEADER, verify_proof
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

    A session token alone must not be enough to destroy ciphertext; the client
    proves it holds the unlocked private key by answering a challenge from
    POST /auth/vault/challenge.
    """
    proof = request.headers.get(VAULT_PROOF_HEADER)
    if not verify_proof(proof, user.vault_proof_hash, user.vault_proof_expires_at):
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


# Type aliases for cleaner dependency injection
CurrentUser = Annotated[User, Depends(get_current_active_user)]
AdminUser = Annotated[User, Depends(get_current_admin_user)]
VaultProvenUser = Annotated[User, Depends(get_vault_proven_user)]
DbSession = Annotated[AsyncSession, Depends(get_db)]
