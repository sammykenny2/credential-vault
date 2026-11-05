"""Security utilities: JWT token operations, password hashing and session cookies."""

from datetime import UTC, datetime, timedelta

import anyio
import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from fastapi import Response

from app.config import get_settings

settings = get_settings()

# Sign-in passwords are hashed with Argon2id, using argon2-cffi's defaults
# (the RFC 9106 low-memory profile: t=3, m=64 MiB, p=4). Raising them later
# needs no reset: hashes with older parameters are rehashed at the next login.
password_hasher = PasswordHasher()

# Bounds for a new sign-in password. Argon2 has no input limit (unlike bcrypt's
# 72 bytes); the maximum only keeps request bodies reasonable.
MIN_PASSWORD_LENGTH = 8
MAX_PASSWORD_LENGTH = 1024

# Verified against when no real hash exists, so a login attempt for an unknown
# address costs the same Argon2 work as one for a real account.
DUMMY_PASSWORD_HASH = password_hasher.hash("not-a-real-password")

# The refresh token travels only in an HttpOnly cookie scoped to the auth
# routes, so page scripts (and any XSS payload) cannot read it.
REFRESH_COOKIE_NAME = "refresh_token"
REFRESH_COOKIE_PATH = "/api/v1/auth"


async def hash_password_async(password: str) -> str:
    """At most two 64 MiB Argon2 jobs, off the event loop."""
    return await anyio.to_thread.run_sync(
        SecurityService.hash_password, password, limiter=_password_limiter()
    )


async def verify_password_async(password: str, hashed: str) -> bool:
    return await anyio.to_thread.run_sync(
        SecurityService.verify_password, password, hashed, limiter=_password_limiter()
    )


_limiter: anyio.CapacityLimiter | None = None


def _password_limiter() -> anyio.CapacityLimiter:
    global _limiter
    if _limiter is None:
        _limiter = anyio.CapacityLimiter(2)
    return _limiter


class SecurityService:
    """Security service for JWT, password and cookie operations."""

    @staticmethod
    def create_vault_setup_token(user_id: str, token_version: int, session_id: str) -> str:
        """Independent, short-lived authorization issued only after interactive login."""
        return jwt.encode(
            {
                "sub": user_id,
                "ver": token_version,
                "type": "vault-setup",
                "sid": session_id,
                "exp": datetime.now(UTC) + timedelta(minutes=10),
            },
            settings.secret_key,
            algorithm=settings.jwt_algorithm,
        )

    @staticmethod
    def create_link_token(user_id: str, token_version: int) -> str:
        """Only issued after password verification; never usable as an access token."""
        return jwt.encode(
            {
                "sub": user_id,
                "ver": token_version,
                "type": "google-link",
                "exp": datetime.now(UTC) + timedelta(minutes=5),
            },
            settings.secret_key,
            algorithm=settings.jwt_algorithm,
        )

    @staticmethod
    def hash_password(password: str) -> str:
        """Hash a password with Argon2id."""
        return password_hasher.hash(password)

    @staticmethod
    def verify_password(plain: str, hashed: str) -> bool:
        """Verify a password against its hash.

        False for a wrong password and for anything that is not an Argon2 hash
        (such as a bcrypt hash from before the switch), so those fail closed.
        """
        try:
            return password_hasher.verify(hashed, plain)
        except VerificationError:
            return False
        except InvalidHashError:
            # Spend the same Argon2 work, so timing does not tell this case apart
            try:
                password_hasher.verify(DUMMY_PASSWORD_HASH, plain)
            except VerificationError:
                pass
            return False

    @staticmethod
    def password_needs_rehash(hashed: str) -> bool:
        """True when a valid hash was made with weaker parameters than today's."""
        return password_hasher.check_needs_rehash(hashed)

    @staticmethod
    def create_access_token(
        user_id: str, token_version: int = 0, session_id: str | None = None
    ) -> str:
        """Create a JWT access token bound to the user's current token version."""
        expire = datetime.now(UTC) + timedelta(minutes=settings.access_token_expire_minutes)
        payload: dict = {
            "sub": user_id,
            "exp": expire,
            "type": "access",
            "ver": token_version,
        }
        if session_id is not None:
            payload["sid"] = session_id
        return jwt.encode(payload, settings.secret_key, algorithm=settings.jwt_algorithm)

    @staticmethod
    def create_refresh_token(
        user_id: str,
        token_version: int = 0,
        *,
        session_id: str | None = None,
        token_id: str | None = None,
        expires_at: int | None = None,
    ) -> str:
        """Create a JWT refresh token bound to the user's current token version."""
        expire = datetime.now(UTC) + timedelta(days=settings.refresh_token_expire_days)
        payload: dict = {
            "sub": user_id,
            "exp": expires_at if expires_at is not None else expire,
            "type": "refresh",
            "ver": token_version,
        }
        if session_id is not None:
            payload["sid"] = session_id
            payload["jti"] = token_id
        return jwt.encode(payload, settings.secret_key, algorithm=settings.jwt_algorithm)

    @staticmethod
    def decode_token(token: str) -> dict | None:
        """Decode and validate a JWT token (signature, expiry, algorithm pinned)."""
        try:
            payload = jwt.decode(
                token,
                settings.secret_key,
                algorithms=[settings.jwt_algorithm],
            )
        except jwt.PyJWTError:
            return None
        return dict(payload)

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
