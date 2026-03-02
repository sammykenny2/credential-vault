"""Security utilities: JWT token operations and password hashing."""

from datetime import UTC, datetime, timedelta

from jose import JWTError, jwt
from passlib.context import CryptContext

from app.config import get_settings

settings = get_settings()

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


class SecurityService:
    """Security service for JWT and password operations."""

    @staticmethod
    def hash_password(password: str) -> str:
        """Hash a password using bcrypt."""
        return pwd_context.hash(password)

    @staticmethod
    def verify_password(plain: str, hashed: str) -> bool:
        """Verify a password against its hash."""
        return pwd_context.verify(plain, hashed)

    @staticmethod
    def create_access_token(user_id: str) -> str:
        """Create a JWT access token."""
        expire = datetime.now(UTC) + timedelta(minutes=settings.access_token_expire_minutes)
        payload = {
            "sub": user_id,
            "exp": expire,
            "type": "access",
        }
        return jwt.encode(payload, settings.secret_key, algorithm=settings.jwt_algorithm)  # type: ignore[no-any-return]

    @staticmethod
    def create_refresh_token(user_id: str) -> str:
        """Create a JWT refresh token."""
        expire = datetime.now(UTC) + timedelta(days=settings.refresh_token_expire_days)
        payload = {
            "sub": user_id,
            "exp": expire,
            "type": "refresh",
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
    def create_tokens(user_id: str) -> tuple[str, str]:
        """Create both access and refresh tokens."""
        return (
            SecurityService.create_access_token(user_id),
            SecurityService.create_refresh_token(user_id),
        )
