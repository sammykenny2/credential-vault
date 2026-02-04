"""User schemas."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from src.models.user import UserRole


class UserBase(BaseModel):
    """Base user schema."""

    email: EmailStr
    display_name: str = Field(min_length=1, max_length=100)


class UserCreate(UserBase):
    """User creation schema."""

    password: str = Field(min_length=8, max_length=128)


class UserUpdate(BaseModel):
    """User update schema."""

    display_name: str | None = Field(None, min_length=1, max_length=100)
    is_active: bool | None = None


class UserRoleUpdate(BaseModel):
    """Schema for updating user role (admin only)."""

    role: UserRole


class UserRead(UserBase):
    """User read schema."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    role: UserRole
    mfa_enabled: bool
    is_active: bool
    created_at: datetime
    last_login_at: datetime | None


class UserAdminRead(UserRead):
    """User read schema for admin (no credential access)."""

    model_config = ConfigDict(from_attributes=True)

    # Admin can see user metadata but NOT credentials
    credential_count: int = 0
