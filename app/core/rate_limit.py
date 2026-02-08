"""Rate limiting middleware using slowapi."""

from slowapi import Limiter
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address
from starlette.requests import Request
from starlette.responses import JSONResponse

from app.config import get_settings


def _get_client_ip(request: Request) -> str:
    """Extract client IP for rate limiting."""
    forwarded_for = request.headers.get("X-Forwarded-For")
    if forwarded_for:
        return forwarded_for.split(",")[0].strip()
    return get_remote_address(request)


settings = get_settings()

limiter = Limiter(
    key_func=_get_client_ip,
    default_limits=[f"{settings.rate_limit_per_minute}/minute"],
)


# Stricter limits for auth endpoints
AUTH_RATE_LIMIT = "10/minute"
MFA_RATE_LIMIT = "5/minute"


async def rate_limit_exceeded_handler(request: Request, exc: RateLimitExceeded) -> JSONResponse:
    """Custom handler for rate limit exceeded errors."""
    return JSONResponse(
        status_code=429,
        content={
            "detail": "Too many requests. Please try again later.",
            "retry_after": exc.detail,
        },
    )
