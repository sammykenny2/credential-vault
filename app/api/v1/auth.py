"""Authentication endpoints."""

from fastapi import APIRouter, HTTPException, Request, Response, status

from app.api.deps import (
    CurrentUser,
    DbSession,
    RecentlySignedInUser,
    VaultProvenUser,
    VaultUpgradingUser,
)
from app.config import get_settings
from app.core.rate_limit import AUTH_RATE_LIMIT, limiter
from app.core.security import DUMMY_PASSWORD_HASH, REFRESH_COOKIE_NAME, SecurityService
from app.core.session import issue_session, rotate_session
from app.core.vault_proof import (
    PROOF_TTL_SECONDS,
    SIGNED_PROOF_VERSION,
    UPGRADE_PROOF_VERSION,
    create_signed_challenge,
    create_upgrade_challenge,
)
from app.models.audit_log import AuditAction
from app.models.user import UserRole
from app.schemas.auth import (
    LocalLoginRequest,
    Token,
    VaultRekeyRequest,
    VaultSetupRequest,
    VaultUpgradeRequest,
    VerifyPasswordRequest,
)
from app.services.audit_log import AuditLogService
from app.services.credential import CredentialService
from app.services.user import UserService

router = APIRouter()


@router.post("/login", response_model=Token)
@limiter.limit(AUTH_RATE_LIMIT)
async def local_login(
    request: Request,
    response: Response,
    data: LocalLoginRequest,
    db: DbSession,
):
    """Break-glass local login for admin users only.

    Used when Google OAuth is unavailable. Only admin users with
    a hashed_password set can use this endpoint.
    """
    user_service = UserService(db)
    user = await user_service.get_by_email(data.email)

    # One Argon2 verification on every path and a single error message, so
    # neither timing nor wording reveals whether the address has an account,
    # a password, or admin rights.
    stored_hash = user.hashed_password if user and user.hashed_password else DUMMY_PASSWORD_HASH
    password_ok = SecurityService.verify_password(data.password, stored_hash)
    eligible = bool(user and user.hashed_password and user.role == UserRole.ADMIN)

    if not (eligible and password_ok):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
        )
    assert user is not None and user.hashed_password is not None  # narrowed by `eligible`

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is deactivated",
        )

    # A hash made with weaker Argon2 parameters is upgraded while the password
    # is at hand; saved with the last-login update below.
    if SecurityService.password_needs_rehash(user.hashed_password):
        user.hashed_password = SecurityService.hash_password(data.password)

    # Update last login
    await user_service.update_last_login(user)

    token = issue_session(user, response)

    audit_service = AuditLogService(db)
    await audit_service.log_from_request(
        request,
        action=AuditAction.LOGIN_SUCCESS,
        user_id=user.id,
        details={"method": "local_breakglass"},
    )

    return token


@router.post("/refresh", response_model=Token)
@limiter.limit(AUTH_RATE_LIMIT)
async def refresh_session(
    request: Request,
    response: Response,
    db: DbSession,
):
    """Rotate the session using the HttpOnly refresh cookie.

    The refresh token is never accepted from the query string or body, so it
    cannot end up in access logs or be read by page scripts.
    """
    refresh_token = request.cookies.get(REFRESH_COOKIE_NAME)
    if not refresh_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing refresh token",
        )

    payload = SecurityService.decode_token(refresh_token)

    if not payload or payload.get("type") != "refresh":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid refresh token",
        )

    user_id: str | None = payload.get("sub")
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid refresh token",
        )
    user_service = UserService(db)
    user = await user_service.get_by_id(user_id)

    if not user or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found or inactive",
        )

    if payload.get("ver", 0) != user.token_version:
        SecurityService.clear_refresh_cookie(response)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session has been revoked",
        )

    token = rotate_session(user, response, payload.get("auth_time"))

    audit_service = AuditLogService(db)
    await audit_service.log_from_request(
        request,
        action=AuditAction.TOKEN_REFRESH,
        user_id=user.id,
    )

    return token


@router.post("/logout")
async def logout(
    request: Request,
    response: Response,
    current_user: CurrentUser,
    db: DbSession,
):
    """Sign out everywhere: revoke every token issued to the user and clear the cookie.

    Bumping `token_version` invalidates all outstanding access and refresh
    tokens for this account, including those on other devices.
    """
    current_user.token_version += 1
    await db.flush()

    audit_service = AuditLogService(db)
    await audit_service.log_from_request(
        request,
        action=AuditAction.LOGOUT,
        user_id=current_user.id,
    )

    SecurityService.clear_refresh_cookie(response)
    return {"message": "Logged out"}


@router.get("/me")
async def get_current_user_info(current_user: CurrentUser):
    """Get current user information."""
    return {
        "id": current_user.id,
        "email": current_user.email,
        "display_name": current_user.display_name,
        "role": current_user.role,
        "has_vault_keys": current_user.has_vault_keys,
        "has_google_linked": current_user.has_google_linked,
        "has_password": current_user.has_password,
    }


@router.post("/verify-password")
@limiter.limit(AUTH_RATE_LIMIT)
async def verify_password(
    request: Request,
    data: VerifyPasswordRequest,
    current_user: CurrentUser,
    db: DbSession,
):
    """Verify user's password (for sensitive operations like linking Google account).

    Limited like login: a stale token could otherwise guess the password here at
    full speed, then sign in for real and pass the recent sign-in check.
    """
    if not current_user.hashed_password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No password set for this account",
        )

    if not SecurityService.verify_password(data.password, current_user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid password",
        )

    return {"verified": True}


@router.get("/vault/keys")
async def get_vault_keys(current_user: CurrentUser):
    """Get vault key material for unlocking the vault client-side."""
    if not current_user.has_vault_keys:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Vault keys not configured",
        )
    return {
        "public_key": current_user.public_key,
        "encrypted_private_key": current_user.encrypted_private_key,
        "key_salt": current_user.key_salt,
        "kdf_version": current_user.kdf_version,
    }


@router.put("/vault/keys")
async def rekey_vault(
    request: Request,
    data: VaultRekeyRequest,
    current_user: VaultProvenUser,
    db: DbSession,
):
    """Store a re-wrapped private key after the vault password changed.

    Requires proof of unlock so that a stolen session token cannot replace the
    wrapped key and lock the real owner out. The public key never changes
    here; credentials stay readable.
    """
    if not current_user.has_vault_keys:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Vault keys not configured",
        )

    user_service = UserService(db)
    await user_service.rekey_vault(
        user=current_user,
        encrypted_private_key=data.encrypted_private_key,
        key_salt=data.key_salt,
        kdf_version=data.kdf_version,
    )

    audit_service = AuditLogService(db)
    await audit_service.log_from_request(
        request,
        action=AuditAction.VAULT_REKEY,
        user_id=current_user.id,
    )
    await db.commit()

    return {"message": "Vault password updated"}


@router.post("/vault/upgrade")
async def upgrade_vault(
    request: Request,
    data: VaultUpgradeRequest,
    current_user: VaultUpgradingUser,
    db: DbSession,
):
    """Finish the one-time upgrade of an RSA-only vault to a signed one.

    Stores the key bundle, the signing key and a signature over every existing
    record in one transaction, committed before answering. Those signatures are
    labelled legacy-unverified: they stop later forgeries, they do not claim the
    old records were authentic. Requires proof v1, the only proof such a vault has.
    """
    if not current_user.has_vault_keys:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Vault keys not configured",
        )

    # Conditional, so concurrent upgrades cannot replace a signing key. The updates
    # in adopt_all are conditional on revision too, so no record can be overwritten.
    user_id = current_user.id
    claimed = await UserService(db).complete_vault_upgrade(
        user=current_user,
        encrypted_private_key=data.encrypted_private_key,
        signing_public_key=data.signing_public_key,
    )
    if not claimed:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Vault is already upgraded",
        )

    if not await CredentialService(db).adopt_all(user_id, data.adoptions):
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Credentials changed during the upgrade: unlock the vault again to retry",
        )

    await AuditLogService(db).log_from_request(
        request,
        action=AuditAction.VAULT_UPGRADED,
        user_id=user_id,
        details={"adopted": len(data.adoptions)},
    )
    await db.commit()

    return {"message": "Vault upgraded", "adopted": len(data.adoptions)}


@router.post("/vault/challenge")
async def vault_challenge(current_user: CurrentUser, db: DbSession):
    """Issue a proof-of-unlock challenge.

    A signed vault gets a nonce to sign (proof v2). A vault that has not been
    upgraded gets a secret encrypted to its RSA key under a dedicated OAEP label
    (proof v1). Neither stores anything per challenge, so asking for one cannot
    invalidate another.
    """
    if not current_user.has_vault_keys or not current_user.public_key:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Vault keys not configured",
        )

    if current_user.signing_public_key:
        return {
            "version": SIGNED_PROOF_VERSION,
            "nonce": create_signed_challenge(
                current_user.id, current_user.token_version, get_settings().secret_key
            ),
            "expires_in": PROOF_TTL_SECONDS,
        }

    proof_key = await UserService(db).ensure_vault_proof_key(current_user)
    try:
        challenge, ticket = create_upgrade_challenge(
            current_user.public_key,
            current_user.id,
            current_user.token_version,
            get_settings().secret_key,
            proof_key,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Stored vault public key is unusable; set up the vault again",
        ) from exc

    return {
        "version": UPGRADE_PROOF_VERSION,
        "challenge": challenge,
        "ticket": ticket,
        "expires_in": PROOF_TTL_SECONDS,
    }


@router.post("/vault/setup")
async def setup_vault(
    request: Request,
    data: VaultSetupRequest,
    current_user: RecentlySignedInUser,
    db: DbSession,
):
    """Set up E2EE vault keys for user.

    Called after first login to establish the user's keys. The key bundle is
    encrypted with the user's vault password (client-side); a new vault is
    signed from the start, so it never has unsigned records.

    Needs a recent sign-in: whoever installs the keys passes every later vault
    proof, and an account with no vault has no proof to ask for instead.
    """
    user_service = UserService(db)
    configured = await user_service.setup_vault_keys(
        user=current_user,
        public_key=data.public_key,
        encrypted_private_key=data.encrypted_private_key,
        key_salt=data.key_salt,
        kdf_version=data.kdf_version,
        signing_public_key=data.signing_public_key,
    )
    if configured is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Vault keys already configured",
        )

    audit_service = AuditLogService(db)
    await audit_service.log_from_request(
        request,
        action=AuditAction.VAULT_SETUP,
        user_id=current_user.id,
    )
    await db.commit()

    return {"message": "Vault keys configured successfully"}
