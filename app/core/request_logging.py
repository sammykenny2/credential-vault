"""Request/response logging middleware."""

import logging
import time

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from app.core.client_ip import get_client_ip

logger = logging.getLogger("app.request")

# Paths to exclude from logging
EXCLUDED_PATHS = {"/health", "/docs", "/redoc", "/openapi.json"}

# Headers that should never be logged
SENSITIVE_HEADERS = {"authorization", "cookie", "x-api-key"}


class RequestLoggingMiddleware(BaseHTTPMiddleware):
    """Log HTTP requests and responses (excluding sensitive data)."""

    async def dispatch(self, request: Request, call_next) -> Response:
        if request.url.path in EXCLUDED_PATHS:
            return await call_next(request)  # type: ignore[no-any-return]

        start_time = time.monotonic()

        # Log request
        client_ip = get_client_ip(request) or "unknown"
        logger.info(
            "Request: %s %s",
            request.method,
            request.url.path,
            extra={
                "method": request.method,
                "path": request.url.path,
                "ip_address": client_ip,
            },
        )

        response = await call_next(request)

        # Log response
        duration_ms = (time.monotonic() - start_time) * 1000
        logger.info(
            "Response: %s %s -> %d (%.1fms)",
            request.method,
            request.url.path,
            response.status_code,
            duration_ms,
            extra={
                "method": request.method,
                "path": request.url.path,
                "status_code": response.status_code,
                "ip_address": client_ip,
            },
        )

        return response  # type: ignore[no-any-return]
