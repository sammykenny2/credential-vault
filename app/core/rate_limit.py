"""Rate limiting middleware using slowapi."""

import math
import time

from limits import RateLimitItemPerMinute
from slowapi import Limiter
from slowapi.errors import RateLimitExceeded
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

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
)


class RequestLimitMiddleware(BaseHTTPMiddleware):
    """Aggregate all API requests by trusted client IP, before parsing any body.

    SlowAPI's route discovery misses FastAPI's included-router objects. Use its
    public storage backend directly so new/nested endpoints cannot bypass limits.
    Decorated auth endpoints retain their additional stricter counters.
    """

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        active = request.app.state.limiter
        if active.enabled and request.url.path.startswith("/api/"):
            limit = RateLimitItemPerMinute(get_settings().rate_limit_per_minute)
            identifiers = ("all-api", _rate_limit_key(request))
            if not active.limiter.hit(limit, *identifiers):
                window = active.limiter.get_window_stats(limit, *identifiers)
                retry = max(1, math.ceil(window.reset_time - time.time()))
                return JSONResponse(
                    {"detail": "Too many requests. Please try again later."},
                    status_code=429,
                    headers={"Retry-After": str(retry)},
                )
        return await call_next(request)


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
