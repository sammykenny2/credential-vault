"""Session issuance: access token in the response body, refresh token in a cookie."""

from fastapi import Response

from app.config import get_settings
from app.core.security import SecurityService
from app.models.user import User
from app.schemas.auth import Token


def issue_session(user: User, response: Response) -> Token:
    """Create a token pair for the user, attach the refresh cookie, return the body.

    The access token is short-lived and kept in memory by the client. The
    refresh token never appears in the body; it is only set as an HttpOnly
    cookie scoped to the auth routes.
    """
    settings = get_settings()
    access_token, refresh_token = SecurityService.create_tokens(user.id, user.token_version)
    SecurityService.set_refresh_cookie(response, refresh_token)
    return Token(
        access_token=access_token,
        expires_in=settings.access_token_expire_minutes * 60,
    )
