"""Tailscale integration utilities.

This module provides middleware and utilities for verifying that requests
originate from the Tailscale network, adding an extra layer of security.
"""

import ipaddress
from typing import Callable

from fastapi import HTTPException, Request, status
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response

from app.config import get_settings

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


def get_client_ip(request: Request) -> str:
    """
    Extract the real client IP from the request.

    Checks X-Forwarded-For header first (for reverse proxy setups),
    then falls back to the direct client IP.

    Args:
        request: FastAPI Request object

    Returns:
        Client IP address string
    """
    # Check X-Forwarded-For header (set by reverse proxies)
    forwarded_for = request.headers.get("X-Forwarded-For")
    if forwarded_for:
        # X-Forwarded-For can contain multiple IPs: client, proxy1, proxy2, ...
        # The first one is the original client
        return forwarded_for.split(",")[0].strip()

    # Check X-Real-IP header (alternative header)
    real_ip = request.headers.get("X-Real-IP")
    if real_ip:
        return real_ip.strip()

    # Fall back to direct client IP
    if request.client:
        return request.client.host

    return ""


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

    async def dispatch(
        self, request: Request, call_next: Callable[[Request], Response]
    ) -> Response:
        settings = get_settings()

        # Skip check if not required
        if not settings.require_tailscale:
            return await call_next(request)

        # Skip check for exempt paths
        if request.url.path in self.EXEMPT_PATHS:
            return await call_next(request)

        # Get client IP
        client_ip = get_client_ip(request)

        # Verify IP is from Tailscale
        if not is_tailscale_ip(client_ip):
            # Log the attempt (in production, you might want proper logging)
            print(f"Blocked non-Tailscale request from {client_ip} to {request.url.path}")

            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access denied. This service is only accessible via Tailscale.",
            )

        # Add Tailscale info to request state for later use
        request.state.tailscale_ip = client_ip
        request.state.is_tailscale = True

        return await call_next(request)


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
