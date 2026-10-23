"""Tailscale integration utilities.

This module provides middleware and utilities for verifying that requests
originate from the Tailscale network, adding an extra layer of security.
"""

import ipaddress
import logging
from collections.abc import Callable

from fastapi import HTTPException, Request, status
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response

from app.config import get_settings
from app.core.client_ip import get_client_ip

__all__ = ["TailscaleMiddleware", "get_client_ip", "get_tailscale_user_info", "is_tailscale_ip"]

logger = logging.getLogger(__name__)

# Tailscale CGNAT IP range (100.64.0.0/10)
TAILSCALE_CGNAT_RANGE = ipaddress.ip_network("100.64.0.0/10")


def is_tailscale_ip(ip: str) -> bool:
    """
    Check if an IP address is within the Tailscale CGNAT range.

    Args:
        ip: IP address string to check

    Returns:
        True if the IP is a Tailscale IP
    """
    try:
        addr = ipaddress.ip_address(ip)
        return addr in TAILSCALE_CGNAT_RANGE
    except ValueError:
        return False


class TailscaleMiddleware(BaseHTTPMiddleware):
    """
    Middleware to verify requests come from Tailscale network.

    This middleware checks that the client IP is within the Tailscale
    CGNAT range (100.64.0.0/10). Requests from outside this range
    are rejected with a 403 Forbidden response.

    Can be disabled by setting REQUIRE_TAILSCALE=false in environment.
    """

    # Paths that bypass Tailscale check (health checks, etc.)
    EXEMPT_PATHS = {"/health", "/api/v1/health"}

    async def dispatch(  # type: ignore[override]
        self, request: Request, call_next: Callable[[Request], Response]
    ) -> Response:
        settings = get_settings()

        # Skip check if not required
        if not settings.require_tailscale:
            return await call_next(request)  # type: ignore[misc,no-any-return]

        # Skip check for exempt paths
        if request.url.path in self.EXEMPT_PATHS:
            return await call_next(request)  # type: ignore[misc,no-any-return]

        # Resolve the client address through the trusted proxy chain only
        client_ip = get_client_ip(request)

        # Verify IP is from Tailscale
        if not is_tailscale_ip(client_ip):
            logger.warning(
                "Blocked non-Tailscale request from %r to %s", client_ip, request.url.path
            )

            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access denied. This service is only accessible via Tailscale.",
            )

        # Add Tailscale info to request state for later use
        request.state.tailscale_ip = client_ip
        request.state.is_tailscale = True

        return await call_next(request)  # type: ignore[misc,no-any-return]


def get_tailscale_user_info(request: Request) -> dict | None:
    """
    Extract Tailscale user information from request headers.

    When using Tailscale Serve/Funnel, Tailscale can add headers
    with user identity information.

    Args:
        request: FastAPI Request object

    Returns:
        Dictionary with user info, or None if not available
    """
    # Tailscale Serve can add these headers
    tailscale_user = request.headers.get("Tailscale-User-Login")
    tailscale_name = request.headers.get("Tailscale-User-Name")
    tailscale_profile_pic = request.headers.get("Tailscale-User-Profile-Pic")

    if tailscale_user:
        return {
            "login": tailscale_user,
            "name": tailscale_name,
            "profile_pic": tailscale_profile_pic,
        }

    return None
