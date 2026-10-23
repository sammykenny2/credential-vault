"""Security utilities: JWT token operations, password hashing and session cookies."""

from datetime import UTC, datetime, timedelta

from fastapi import Response
from jose import JWTError, jwt
from passlib.context import CryptContext

from app.config import get_settings

settings = get_settings()

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# The refresh token travels only in an HttpOnly cookie scoped to the auth
# routes, so page scripts (and any XSS payload) cannot read it.
REFRESH_COOKIE_NAME = "refresh_token"
REFRESH_COOKIE_PATH = "/api/v1/auth"


class SecurityService:
    """Security service for JWT, password and cookie operations."""

    @staticmethod
    def hash_password(password: str) -> str:
        """Hash a password using bcrypt."""
        return pwd_context.hash(password)

    @staticmethod
    def verify_password(plain: str, hashed: str) -> bool:
        """Verify a password against its hash."""
        return pwd_context.verify(plain, hashed)

    @staticmethod
    def create_access_token(user_id: str, token_version: int = 0) -> str:
        """Create a JWT access token bound to the user's current token version."""
        expire = datetime.now(UTC) + timedelta(minutes=settings.access_token_expire_minutes)
        payload = {
            "sub": user_id,
            "exp": expire,
            "type": "access",
            "ver": token_version,
        }
        return jwt.encode(payload, settings.secret_key, algorithm=settings.jwt_algorithm)  # type: ignore[no-any-return]

    @staticmethod
    def create_refresh_token(user_id: str, token_version: int = 0) -> str:
        """Create a JWT refresh token bound to the user's current token version."""
        expire = datetime.now(UTC) + timedelta(days=settings.refresh_token_expire_days)
        payload = {
            "sub": user_id,
            "exp": expire,
            "type": "refresh",
            "ver": token_version,
        }
        return jwt.encode(payload, settings.secret_key, algorithm=settings.jwt_algorithm)  # type: ignore[no-any-return]

    @staticmethod
    def decode_token(token: str) -> dict | None:
        """Decode and validate a JWT token."""
        try:
            payload = jwt.decode(
                token,
                settings.secret_key,
                algorithms=[settings.jwt_algorithm],
            )
            return payload  # type: ignore[no-any-return]
        except JWTError:
            return None

    @staticmethod
    def create_tokens(user_id: str, token_version: int = 0) -> tuple[str, str]:
        """Create both access and refresh tokens."""
        return (
            SecurityService.create_access_token(user_id, token_version),
            SecurityService.create_refresh_token(user_id, token_version),
        )

    @staticmethod
    def set_refresh_cookie(response: Response, refresh_token: str) -> None:
        """Attach the refresh token as an HttpOnly, SameSite=Strict cookie."""
        response.set_cookie(
            key=REFRESH_COOKIE_NAME,
            value=refresh_token,
            max_age=settings.refresh_token_expire_days * 86400,
            path=REFRESH_COOKIE_PATH,
            httponly=True,
            secure=settings.is_production,
            samesite="strict",
        )

    @staticmethod
    def clear_refresh_cookie(response: Response) -> None:
        """Expire the refresh cookie."""
        response.delete_cookie(
            key=REFRESH_COOKIE_NAME,
            path=REFRESH_COOKIE_PATH,
            httponly=True,
            secure=settings.is_production,
            samesite="strict",
        )
