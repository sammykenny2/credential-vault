"""Bootstrap service for initial setup."""

import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.user import User, UserRole
from app.services.user import UserService
from app.schemas.user import UserCreate

logger = logging.getLogger(__name__)


class BootstrapService:
    """Service for application bootstrap operations."""

    def __init__(self, db: AsyncSession):
        self.db = db
        self.settings = get_settings()

    async def has_any_admin(self) -> bool:
        """Check if any admin user exists."""
        result = await self.db.execute(
            select(User).where(User.role == UserRole.ADMIN).limit(1)
        )
        return result.scalar_one_or_none() is not None

    async def create_initial_admin(self) -> User | None:
        """Create initial admin from environment variables if no admin exists.

        Returns the created admin user, or None if:
        - An admin already exists
        - Environment variables are not set
        - Email already exists (as non-admin user)
        """
        # Check if admin already exists
        if await self.has_any_admin():
            logger.debug("Admin user already exists, skipping bootstrap")
            return None

        # Check if environment variables are set
        if not self.settings.admin_email or not self.settings.admin_password:
            logger.warning(
                "No admin exists and ADMIN_EMAIL/ADMIN_PASSWORD not set. "
                "Set these environment variables or use CLI to create admin."
            )
            return None

        user_service = UserService(self.db)

        # Check if email already exists
        existing = await user_service.get_by_email(self.settings.admin_email)
        if existing:
            if existing.role == UserRole.ADMIN:
                logger.debug("Admin user already exists with this email")
                return None
            else:
                # Promote existing user to admin
                logger.info(f"Promoting existing user {existing.email} to admin")
                existing.role = UserRole.ADMIN
                await self.db.flush()
                await self.db.refresh(existing)
                return existing

        # Create new admin user
        logger.info(f"Creating initial admin user: {self.settings.admin_email}")
        user_data = UserCreate(
            email=self.settings.admin_email,
            password=self.settings.admin_password,
            display_name=self.settings.admin_display_name,
        )
        admin = await user_service.create(user_data, role=UserRole.ADMIN)
        await self.db.commit()

        logger.info(f"Initial admin created successfully: {admin.email}")
        return admin


async def run_bootstrap(db: AsyncSession) -> None:
    """Run bootstrap operations on application startup."""
    bootstrap = BootstrapService(db)
    await bootstrap.create_initial_admin()
