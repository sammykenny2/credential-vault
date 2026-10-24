"""Bootstrap service for initial setup."""

import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.core.security import SecurityService
from app.models.user import User, UserRole

logger = logging.getLogger(__name__)


class BootstrapService:
    """Service for application bootstrap operations."""

    def __init__(self, db: AsyncSession):
        self.db = db
        self.settings = get_settings()

    async def has_any_admin(self) -> bool:
        """Check if any admin user exists."""
        result = await self.db.execute(select(User).where(User.role == UserRole.ADMIN).limit(1))
        return result.scalar_one_or_none() is not None

    async def check_admin_bootstrap(self) -> None:
        """Log bootstrap status and create break-glass admin on startup.

        While no admin exists, the Google account that signs in becomes the
        admin (only the ADMIN_EMAIL account when that is set), or the admin is
        created on the /admin/setup page. See app/api/v1/oauth.py.

        If ADMIN_PASSWORD is also set and no admin exists yet,
        creates the admin with a hashed password for break-glass login.
        """
        if await self.has_any_admin():
            logger.debug("Admin user already exists")
            return

        if self.settings.admin_email:
            if self.settings.admin_password:
                # Create admin with hashed password for break-glass login
                hashed = SecurityService.hash_password(self.settings.admin_password)
                admin = User(
                    email=self.settings.admin_email,
                    display_name=self.settings.admin_display_name,
                    hashed_password=hashed,
                    role=UserRole.ADMIN,
                    google_id=f"bootstrap-{self.settings.admin_email}",
                )
                self.db.add(admin)
                await self.db.flush()
                logger.info(
                    "Break-glass admin created: '%s' with local password.",
                    self.settings.admin_email,
                )
            else:
                logger.info(
                    "No admin exists. The first Google OAuth login with "
                    "email '%s' will be auto-promoted to admin.",
                    self.settings.admin_email,
                )
        else:
            logger.warning(
                "No admin exists. The first Google sign-in becomes the admin, "
                "or create one on the /admin/setup page. Until then anyone who "
                "can reach the site can claim it."
            )


async def run_bootstrap(db: AsyncSession) -> None:
    """Run bootstrap operations on application startup."""
    bootstrap = BootstrapService(db)
    await bootstrap.check_admin_bootstrap()
