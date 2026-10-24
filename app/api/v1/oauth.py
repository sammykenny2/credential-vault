"""Google OAuth 2.0 authentication endpoints."""

import logging
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, HTTPException, Query, Request, Response, status

from app.api.deps import DbSession
from app.config import get_settings
from app.core.rate_limit import AUTH_RATE_LIMIT, limiter
from app.core.session import issue_session
from app.models.audit_log import AuditAction
from app.models.user import UserRole
from app.schemas.auth import GoogleOAuthCallback, Token
from app.services.audit_log import AuditLogService
from app.services.user import UserService

logger = logging.getLogger(__name__)

router = APIRouter()

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo"


@router.get("/google/authorize")
async def google_authorize(
    redirect_uri: str,
    state: str = Query(
        ...,
        min_length=16,
        max_length=256,
        description="Random value generated and remembered by the browser; it must come "
        "back unchanged in the callback (login CSRF protection).",
    ),
):
    """Get Google OAuth authorization URL.

    The frontend generates `state`, stores it for the current tab and verifies
    it when Google redirects back before calling the callback endpoint.
    """
    settings = get_settings()

    if not settings.google_client_id:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Google OAuth not configured",
        )

    params = {
        "client_id": settings.google_client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": "openid email profile",
        "state": state,
        # Only an identity assertion is needed: no offline access, no Google refresh token.
        "prompt": "select_account",
    }

    return {"authorization_url": f"{GOOGLE_AUTH_URL}?{urlencode(params)}"}


async def exchange_google_code(code: str, redirect_uri: str) -> dict:
    """Exchange a Google OAuth authorization code for user info.

    Returns dict with keys: google_id, email, display_name.
    Raises HTTPException on failure.
    """
    settings = get_settings()

    # Exchange code for Google tokens
    async with httpx.AsyncClient() as client:
        token_response = await client.post(
            GOOGLE_TOKEN_URL,
            data={
                "code": code,
                "client_id": settings.google_client_id,
                "client_secret": settings.google_client_secret,
                "redirect_uri": redirect_uri,
                "grant_type": "authorization_code",
            },
        )

    if token_response.status_code != 200:
        logger.warning("Google token exchange failed: %s", token_response.text)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Failed to authenticate with Google",
        )

    google_tokens = token_response.json()
    google_access_token = google_tokens.get("access_token")

    # Fetch user info from Google
    async with httpx.AsyncClient() as client:
        userinfo_response = await client.get(
            GOOGLE_USERINFO_URL,
            headers={"Authorization": f"Bearer {google_access_token}"},
        )

    if userinfo_response.status_code != 200:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Failed to fetch Google user info",
        )

    google_user = userinfo_response.json()
    google_id = google_user.get("id")
    email = google_user.get("email")
    display_name = google_user.get("name", email)

    if not google_id or not email:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid Google user info",
        )

    # Accounts are matched and auto-linked by email, so an unverified address
    # must never be trusted as proof of ownership.
    if google_user.get("verified_email") is not True:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Google account email is not verified",
        )

    return {"google_id": google_id, "email": email, "display_name": display_name}


@router.post("/google/callback", response_model=Token)
@limiter.limit(AUTH_RATE_LIMIT)
async def google_callback(
    request: Request,
    response: Response,
    data: GoogleOAuthCallback,
    db: DbSession,
):
    """Exchange Google OAuth code for tokens and authenticate user.

    Creates a new user account if one doesn't exist for the Google account.
    """
    settings = get_settings()
    audit_service = AuditLogService(db)

    try:
        google_info = await exchange_google_code(data.code, data.redirect_uri)
    except HTTPException:
        await audit_service.log_from_request(
            request,
            action=AuditAction.LOGIN_FAILURE,
            details={"reason": "google_token_exchange_failed"},
        )
        raise

    google_id = google_info["google_id"]
    email = google_info["email"]
    display_name = google_info["display_name"]

    user_service = UserService(db)

    # Look up user by google_id first, then by email
    user = await user_service.get_by_google_id(google_id)

    if not user:
        # Try matching by email (first-time OAuth link)
        user = await user_service.get_by_email(email)
        if user:
            # Link Google account to existing user
            await user_service.link_google_account(user, google_id)
        else:
            user = await user_service.create_oauth_user(
                email=email,
                display_name=display_name,
                google_id=google_id,
                role=UserRole.USER,
            )
            await db.commit()

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User account is deactivated",
        )

    # While no admin exists, the Google account that signs in becomes the
    # admin, the same first-come window as the /admin/setup page. ADMIN_EMAIL,
    # when set, limits this to that address. Applies to existing accounts too,
    # so a user who signed in before any admin existed is promoted next time.
    promoted_from: UserRole | None = None
    if user.role != UserRole.ADMIN and (not settings.admin_email or email == settings.admin_email):
        from app.services.bootstrap import BootstrapService

        if not await BootstrapService(db).has_any_admin():
            promoted_from = user.role
            user.role = UserRole.ADMIN
            logger.info("No admin exists: promoting user %s to admin", user.id)

    # Update last login
    await user_service.update_last_login(user)
    await db.commit()

    # Access token in the body, refresh token as an HttpOnly cookie
    token = issue_session(user, response)

    await audit_service.log_from_request(
        request,
        action=AuditAction.OAUTH_LOGIN,
        user_id=user.id,
        details={"provider": "google"},
    )
    if promoted_from is not None:
        await audit_service.log_from_request(
            request,
            action=AuditAction.USER_ROLE_CHANGED,
            user_id=user.id,
            resource_type="user",
            resource_id=user.id,
            details={
                "old_role": promoted_from.value,
                "new_role": UserRole.ADMIN.value,
                "reason": "first_admin_google_sign_in",
            },
        )
    await db.commit()

    return token
