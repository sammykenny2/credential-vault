"""Rate limiting middleware using slowapi."""

from slowapi import Limiter
from slowapi.errors import RateLimitExceeded
from starlette.requests import Request
from starlette.responses import JSONResponse

from app.config import get_settings
from app.core.client_ip import get_client_ip


def _rate_limit_key(request: Request) -> str:
    """Key requests by the client address resolved through trusted proxies only."""
    return get_client_ip(request) or "unknown"


settings = get_settings()

# Counters live in process memory: run uvicorn with a single worker (see
# Dockerfile) or every worker keeps its own count.
limiter = Limiter(
    key_func=_rate_limit_key,
    default_limits=[f"{settings.rate_limit_per_minute}/minute"],
)


# Stricter limits for auth endpoints
AUTH_RATE_LIMIT = "10/minute"


async def rate_limit_exceeded_handler(request: Request, exc: RateLimitExceeded) -> JSONResponse:
    """Custom handler for rate limit exceeded errors."""
    return JSONResponse(
        status_code=429,
        content={
            "detail": "Too many requests. Please try again later.",
            "retry_after": exc.detail,
        },
    )
