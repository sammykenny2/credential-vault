"""User management endpoints."""

from fastapi import APIRouter, HTTPException, status

from src.api.deps import AdminUser, CurrentUser, DbSession
from src.models.user import UserRole
from src.schemas.user import UserAdminRead, UserCreate, UserRead, UserUpdate
from src.services.user import UserService

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


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def deactivate_user(
    user_id: str,
    admin_user: AdminUser,
    db: DbSession,
):
    """Deactivate user (admin only). Does not delete credentials."""
    if user_id == admin_user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot deactivate yourself",
        )

    user_service = UserService(db)
    user = await user_service.get_by_id(user_id)

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    await user_service.deactivate(user)
