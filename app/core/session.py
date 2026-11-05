"""Session issuance: access token in the response body, refresh token in a cookie."""

from datetime import UTC, datetime

from fastapi import Response

from app.config import get_settings
from app.core.security import SecurityService
from app.models.user import User
from app.schemas.auth import Token


def issue_session(user: User, response: Response) -> Token:
    """Start a session for a user who has just signed in.

    The access token is short-lived and kept in memory by the client. The
    refresh token never appears in the body; it is only set as an HttpOnly
    cookie scoped to the auth routes.
    """
    return _issue(user, response, int(datetime.now(UTC).timestamp()))


def rotate_session(user: User, response: Response, auth_time: object) -> Token:
    """Replace a session's tokens, keeping the time the user actually signed in.

    Refreshing is not signing in: a refresh token, stolen or not, must not make
    an old session look recent. A token from before ``auth_time`` existed stays
    without one, so it never counts as recent.
    """
    return _issue(user, response, auth_time if type(auth_time) is int else None)


def _issue(user: User, response: Response, auth_time: int | None) -> Token:
    settings = get_settings()
    access_token, refresh_token = SecurityService.create_tokens(
        user.id, user.token_version, auth_time
    )
    SecurityService.set_refresh_cookie(response, refresh_token)
    return Token(
        access_token=access_token,
        expires_in=settings.access_token_expire_minutes * 60,
    )
