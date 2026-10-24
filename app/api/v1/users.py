"""User management endpoints."""

from fastapi import APIRouter, HTTPException, Query, Request, status

from app.api.deps import AdminUser, CurrentUser, DbSession, VaultProvenUser
from app.core.security import SecurityService
from app.models.audit_log import AuditAction
from app.models.user import UserRole
from app.schemas.auth import GoogleOAuthCallback
from app.schemas.user import (
    PasswordSet,
    UserAdminRead,
    UserCreate,
    UserRead,
    UserRoleUpdate,
    UserUpdate,
)
from app.services.audit_log import AuditLogService
from app.services.user import UserService

router = APIRouter()


@router.get("/me", response_model=UserRead)
async def get_me(current_user: CurrentUser):
    """Get current user profile."""
    return current_user


@router.patch("/me", response_model=UserRead)
async def update_me(
    data: UserUpdate,
    current_user: CurrentUser,
    db: DbSession,
):
    """Update current user profile."""
    # Users cannot change their own is_active status
    if data.is_active is not None:
        data.is_active = None

    user_service = UserService(db)
    updated_user = await user_service.update(current_user, data)
    return updated_user


@router.put("/me/password", response_model=UserRead)
async def set_my_password(
    request: Request,
    data: PasswordSet,
    current_user: VaultProvenUser,
    db: DbSession,
):
    """Add a password to an admin account that has none.

    An admin who became admin through Google sign-in has no password; with one
    the account is the same as an admin created on /admin/setup and later
    linked to Google: it signs in with Google or with email and password
    (POST /auth/login). Requires proof of unlock, so a stolen session token
    cannot add a password and keep access. Changing an existing password is
    not supported here.
    """
    if current_user.role != UserRole.ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only administrators can sign in with a password",
        )
    if current_user.has_password:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A password is already set for this account",
        )

    current_user.hashed_password = SecurityService.hash_password(data.password)
    await db.flush()

    await AuditLogService(db).log_from_request(
        request,
        action=AuditAction.USER_UPDATED,
        user_id=current_user.id,
        resource_type="user",
        resource_id=current_user.id,
        details={"password": "set"},
    )
    return current_user


@router.post("/me/link-google", response_model=UserRead)
async def link_google_account(
    request: Request,
    data: GoogleOAuthCallback,
    current_user: CurrentUser,
    db: DbSession,
):
    """Link a Google account to the current user.

    Used by setup-wizard admins who have a placeholder google_id (setup-*)
    to bind their real Google account for OAuth login.
    """
    from app.api.v1.oauth import exchange_google_code

    # Exchange the OAuth code for Google user info
    google_info = await exchange_google_code(data.code, data.redirect_uri)
    google_id = google_info["google_id"]
    google_email = google_info["email"]

    # Verify email matches (case-insensitive)
    if current_user.email.lower() != google_email.lower():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Google account email does not match your account email",
        )

    # Check google_id not already used by another user
    user_service = UserService(db)
    existing = await user_service.get_by_google_id(google_id)
    if existing and existing.id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This Google account is already linked to another user",
        )

    # Link the account
    await user_service.link_google_account(current_user, google_id)

    audit_service = AuditLogService(db)
    await audit_service.log_from_request(
        request,
        action=AuditAction.GOOGLE_ACCOUNT_LINKED,
        user_id=current_user.id,
        details={"google_id": google_id},
    )

    await db.commit()
    await db.refresh(current_user)
    return current_user


# ==================== Admin Endpoints ====================


@router.get("/", response_model=list[UserAdminRead])
async def list_users(
    admin_user: AdminUser,
    db: DbSession,
    skip: int = 0,
    limit: int = 100,
):
    """List all users (admin only)."""
    user_service = UserService(db)
    users = await user_service.list_all(skip=skip, limit=limit)

    result = []
    for user in users:
        credential_count = await user_service.get_credential_count(user.id)
        user_data = UserAdminRead.model_validate(user)
        user_data.credential_count = credential_count
        result.append(user_data)

    return result


@router.post("/", response_model=UserRead, status_code=status.HTTP_201_CREATED)
async def create_user(
    request: Request,
    data: UserCreate,
    admin_user: AdminUser,
    db: DbSession,
):
    """Create a new user (admin only).

    Creates a user account that can be claimed via Google OAuth login.
    """
    user_service = UserService(db)

    # Check if email already exists
    existing = await user_service.get_by_email(data.email)
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered",
        )

    user = await user_service.create(data, role=UserRole.USER)

    audit_service = AuditLogService(db)
    await audit_service.log_from_request(
        request,
        action=AuditAction.USER_CREATED,
        user_id=admin_user.id,
        resource_type="user",
        resource_id=user.id,
        details={"email": user.email},
    )

    return user


@router.get("/{user_id}", response_model=UserAdminRead)
async def get_user(
    user_id: str,
    admin_user: AdminUser,
    db: DbSession,
):
    """Get user by ID (admin only)."""
    user_service = UserService(db)
    user = await user_service.get_by_id(user_id)

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    credential_count = await user_service.get_credential_count(user.id)
    user_data = UserAdminRead.model_validate(user)
    user_data.credential_count = credential_count

    return user_data


@router.patch("/{user_id}", response_model=UserRead)
async def update_user(
    user_id: str,
    data: UserUpdate,
    admin_user: AdminUser,
    db: DbSession,
):
    """Update user (admin only)."""
    user_service = UserService(db)
    user = await user_service.get_by_id(user_id)

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    updated_user = await user_service.update(user, data)
    return updated_user


@router.patch("/{user_id}/role", response_model=UserRead)
async def update_user_role(
    request: Request,
    user_id: str,
    data: UserRoleUpdate,
    admin_user: AdminUser,
    db: DbSession,
):
    """Update user role (admin only).

    Admins can demote themselves only if there is at least one other active admin.
    """
    user_service = UserService(db)

    # Check if trying to change own role
    if user_id == admin_user.id:
        # Allow self-demotion only if not the last admin
        if data.role != UserRole.ADMIN:
            if await user_service.is_last_admin(admin_user):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Cannot demote yourself: you are the last admin",
                )
        else:
            # No change needed if already admin
            return admin_user

    user = await user_service.get_by_id(user_id)

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    old_role = user.role
    user.role = data.role
    await db.flush()
    await db.refresh(user)

    audit_service = AuditLogService(db)
    await audit_service.log_from_request(
        request,
        action=AuditAction.USER_ROLE_CHANGED,
        user_id=admin_user.id,
        resource_type="user",
        resource_id=user_id,
        details={"old_role": old_role.value, "new_role": data.role.value},
    )

    return user


@router.post("/{user_id}/reactivate", response_model=UserRead)
async def reactivate_user(
    request: Request,
    user_id: str,
    admin_user: AdminUser,
    db: DbSession,
):
    """Reactivate a deactivated user (admin only)."""
    user_service = UserService(db)
    user = await user_service.get_by_id(user_id)

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    if user.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User is already active",
        )

    reactivated = await user_service.reactivate(user)

    audit_service = AuditLogService(db)
    await audit_service.log_from_request(
        request,
        action=AuditAction.USER_REACTIVATED,
        user_id=admin_user.id,
        resource_type="user",
        resource_id=user_id,
    )

    return reactivated


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(
    request: Request,
    user_id: str,
    admin_user: AdminUser,
    db: DbSession,
    hard_delete: bool = Query(
        False,
        description="Permanently delete user and all data (cannot be undone)",
    ),
    delete_credentials: bool = Query(
        False,
        description="Also delete credentials (only used when hard_delete=false)",
    ),
):
    """Delete or deactivate user (admin only).

    - Default: Soft delete (deactivate). User record and credentials preserved.
    - delete_credentials=true: Deactivate and delete credentials.
    - hard_delete=true: Permanently remove user and all credentials from database.
    """
    if user_id == admin_user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot delete yourself",
        )

    user_service = UserService(db)
    user = await user_service.get_by_id(user_id)

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    # Protect the last admin from deletion/deactivation
    if await user_service.is_last_admin(user):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot delete or deactivate the last admin",
        )

    audit_service = AuditLogService(db)

    if hard_delete:
        # Permanently delete user and all data
        await audit_service.log_from_request(
            request,
            action=AuditAction.USER_DELETED,
            user_id=admin_user.id,
            resource_type="user",
            resource_id=user_id,
            details={"email": user.email, "hard_delete": True},
        )
        await user_service.hard_delete(user)
    else:
        # Soft delete (deactivate)
        if delete_credentials:
            await user_service.delete_user_credentials(user.id)
        await user_service.deactivate(user)
        await audit_service.log_from_request(
            request,
            action=AuditAction.USER_DEACTIVATED,
            user_id=admin_user.id,
            resource_type="user",
            resource_id=user_id,
            details={"email": user.email},
        )
