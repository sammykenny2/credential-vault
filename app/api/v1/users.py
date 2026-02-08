"""User management endpoints."""

from fastapi import APIRouter, HTTPException, Query, Request, status

from app.api.deps import AdminUser, CurrentUser, DbSession
from app.models.audit_log import AuditAction
from app.models.user import UserRole
from app.schemas.user import UserAdminRead, UserCreate, UserRead, UserRoleUpdate, UserUpdate
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
    """Create a new user (admin only)."""
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
