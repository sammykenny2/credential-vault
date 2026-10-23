"""User service for business logic."""

import logging
from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.credential import Credential
from app.models.user import User, UserRole
from app.schemas.user import UserCreate, UserUpdate

logger = logging.getLogger(__name__)


class UserService:
    """Service for user operations."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_by_id(self, user_id: str) -> User | None:
        """Get user by ID."""
        result = await self.db.execute(select(User).where(User.id == user_id))
        return result.scalar_one_or_none()

    async def get_by_email(self, email: str) -> User | None:
        """Get user by email."""
        result = await self.db.execute(select(User).where(User.email == email))
        return result.scalar_one_or_none()

    async def get_by_google_id(self, google_id: str) -> User | None:
        """Get user by Google OAuth ID."""
        result = await self.db.execute(select(User).where(User.google_id == google_id))
        return result.scalar_one_or_none()

    async def create(self, data: UserCreate, role: UserRole = UserRole.USER) -> User:
        """Create a new user (admin-created, no OAuth)."""
        user = User(
            email=data.email,
            display_name=data.display_name,
            google_id=data.google_id,
            role=role,
        )
        self.db.add(user)
        await self.db.flush()
        await self.db.refresh(user)
        logger.info("User created: %s (role=%s)", user.email, role.value)
        return user

    async def create_oauth_user(
        self,
        email: str,
        display_name: str,
        google_id: str,
        role: UserRole = UserRole.USER,
    ) -> User:
        """Create a new user from Google OAuth login."""
        user = User(
            email=email,
            display_name=display_name,
            google_id=google_id,
            role=role,
        )
        self.db.add(user)
        await self.db.flush()
        await self.db.refresh(user)
        logger.info("OAuth user created: %s (role=%s)", user.email, role.value)
        return user

    async def link_google_account(self, user: User, google_id: str) -> User:
        """Link a Google account to an existing user."""
        user.google_id = google_id
        await self.db.flush()
        logger.info("Google account linked for user: %s", user.email)
        return user

    async def setup_vault_keys(
        self,
        user: User,
        public_key: str,
        encrypted_private_key: str,
        key_salt: str,
        kdf_version: int = 2,
    ) -> User:
        """Set up E2EE vault keys for user."""
        user.public_key = public_key
        user.encrypted_private_key = encrypted_private_key
        user.key_salt = key_salt
        user.kdf_version = kdf_version
        await self.db.flush()
        logger.info("Vault keys configured for user: %s", user.email)
        return user

    async def update(self, user: User, data: UserUpdate) -> User:
        """Update user profile."""
        update_data = data.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(user, field, value)
        await self.db.flush()
        await self.db.refresh(user)
        return user

    async def update_last_login(self, user: User) -> User:
        """Update last login timestamp."""
        user.last_login_at = datetime.now(UTC)
        await self.db.flush()
        return user

    async def deactivate(self, user: User) -> User:
        """Deactivate user account."""
        user.is_active = False
        await self.db.flush()
        return user

    async def reactivate(self, user: User) -> User:
        """Reactivate user account."""
        user.is_active = True
        await self.db.flush()
        return user

    async def hard_delete(self, user: User) -> None:
        """Permanently delete user and all their data from database."""
        # Credentials are deleted via cascade, but let's be explicit
        await self.delete_user_credentials(user.id)
        await self.db.delete(user)
        await self.db.flush()

    async def delete_user_credentials(self, user_id: str) -> int:
        """Delete all credentials for a user. Returns count of deleted credentials."""
        from sqlalchemy import delete

        result = await self.db.execute(delete(Credential).where(Credential.owner_id == user_id))
        await self.db.flush()
        return result.rowcount  # type: ignore[attr-defined,no-any-return]

    async def count_active_admins(self) -> int:
        """Count active admin users."""
        result = await self.db.execute(
            select(func.count(User.id)).where(
                User.role == UserRole.ADMIN,
                User.is_active.is_(True),
            )
        )
        return result.scalar() or 0

    async def is_last_admin(self, user: User) -> bool:
        """Check if user is the last active admin."""
        if user.role != UserRole.ADMIN:
            return False
        count = await self.count_active_admins()
        return count <= 1

    async def list_all(self, skip: int = 0, limit: int = 100) -> list[User]:
        """List all users (admin only)."""
        result = await self.db.execute(
            select(User).offset(skip).limit(limit).order_by(User.created_at.desc())
        )
        return list(result.scalars().all())

    async def get_credential_count(self, user_id: str) -> int:
        """Get credential count for a user (admin view only)."""
        result = await self.db.execute(
            select(func.count(Credential.id)).where(Credential.owner_id == user_id)
        )
        return result.scalar() or 0
