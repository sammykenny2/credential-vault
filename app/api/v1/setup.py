"""Setup endpoints for initial admin account creation."""

from fastapi import APIRouter, HTTPException, Request, Response, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select

from app.api.deps import DbSession
from app.core.rate_limit import AUTH_RATE_LIMIT, limiter
from app.core.security import SecurityService
from app.core.session import issue_session
from app.models.user import User, UserRole
from app.schemas.auth import Token

router = APIRouter()


class SetupStatusResponse(BaseModel):
    """Setup status response."""

    is_initialized: bool


class SetupAdminRequest(BaseModel):
    """Request to create the initial admin account."""

    email: EmailStr
    password: str = Field(min_length=8)
    display_name: str | None = None


@router.get("/status", response_model=SetupStatusResponse)
async def get_setup_status(db: DbSession):
    """Check if the application has been initialized (admin exists)."""
    result = await db.execute(select(User).where(User.role == UserRole.ADMIN).limit(1))
    has_admin = result.scalar_one_or_none() is not None
    return SetupStatusResponse(is_initialized=has_admin)


@router.post("/admin", response_model=Token)
@limiter.limit(AUTH_RATE_LIMIT)
async def create_setup_admin(
    request: Request,
    response: Response,
    data: SetupAdminRequest,
    db: DbSession,
):
    """Create the initial admin account during first-run setup.

    Only works when no admin user exists yet. Returns JWT tokens
    so the new admin is immediately logged in.
    """
    # Check if admin already exists
    result = await db.execute(select(User).where(User.role == UserRole.ADMIN).limit(1))
    if result.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An admin account already exists. Setup is complete.",
        )

    # Create the admin user
    hashed = SecurityService.hash_password(data.password)
    admin = User(
        email=data.email,
        display_name=data.display_name or data.email.split("@")[0],
        hashed_password=hashed,
        role=UserRole.ADMIN,
        google_id=f"setup-{data.email}",
    )
    db.add(admin)
    await db.flush()

    # Access token in the body, refresh token as an HttpOnly cookie
    return issue_session(admin, response)
