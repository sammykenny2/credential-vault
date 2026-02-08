"""Tests for security headers middleware."""

import pytest
from httpx import ASGITransport, AsyncClient
from starlette.applications import Starlette
from starlette.responses import JSONResponse
from starlette.routing import Route

from app.core.security_headers import SecurityHeadersMiddleware


async def homepage(request):
    return JSONResponse({"status": "ok"})


@pytest.fixture
def test_app():
    """Create a minimal test app with security headers middleware."""
    app = Starlette(routes=[Route("/", homepage)])
    app.add_middleware(SecurityHeadersMiddleware)
    return app


class TestSecurityHeaders:
    """Test SecurityHeadersMiddleware adds proper headers."""

    @pytest.mark.asyncio
    async def test_x_frame_options(self, test_app):
        """Test X-Frame-Options header is set."""
        transport = ASGITransport(app=test_app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.get("/")
            assert response.headers["X-Frame-Options"] == "DENY"

    @pytest.mark.asyncio
    async def test_x_content_type_options(self, test_app):
        """Test X-Content-Type-Options header is set."""
        transport = ASGITransport(app=test_app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.get("/")
            assert response.headers["X-Content-Type-Options"] == "nosniff"

    @pytest.mark.asyncio
    async def test_x_xss_protection(self, test_app):
        """Test X-XSS-Protection header is set."""
        transport = ASGITransport(app=test_app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.get("/")
            assert response.headers["X-XSS-Protection"] == "1; mode=block"

    @pytest.mark.asyncio
    async def test_strict_transport_security(self, test_app):
        """Test HSTS header is set."""
        transport = ASGITransport(app=test_app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.get("/")
            assert "max-age=31536000" in response.headers["Strict-Transport-Security"]

    @pytest.mark.asyncio
    async def test_content_security_policy(self, test_app):
        """Test CSP header is set."""
        transport = ASGITransport(app=test_app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.get("/")
            csp = response.headers["Content-Security-Policy"]
            assert "default-src 'self'" in csp
            assert "frame-ancestors 'none'" in csp

    @pytest.mark.asyncio
    async def test_referrer_policy(self, test_app):
        """Test Referrer-Policy header is set."""
        transport = ASGITransport(app=test_app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.get("/")
            assert response.headers["Referrer-Policy"] == "strict-origin-when-cross-origin"

    @pytest.mark.asyncio
    async def test_permissions_policy(self, test_app):
        """Test Permissions-Policy header is set."""
        transport = ASGITransport(app=test_app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.get("/")
            pp = response.headers["Permissions-Policy"]
            assert "camera=()" in pp
            assert "microphone=()" in pp
