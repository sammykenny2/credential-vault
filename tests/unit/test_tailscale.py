"""Tests for Tailscale integration utilities."""

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.core import tailscale
from app.core.client_ip import parse_networks
from app.core.tailscale import (
    TailscaleMiddleware,
    get_client_ip,
    get_tailscale_user_info,
    is_tailscale_ip,
)

TRUSTED = parse_networks("10.0.0.0/8")


@pytest.fixture
def guarded_app(monkeypatch):
    """A tiny app behind TailscaleMiddleware with REQUIRE_TAILSCALE on."""
    monkeypatch.setattr(tailscale, "get_settings", lambda: SimpleNamespace(require_tailscale=True))
    app = FastAPI()
    app.add_middleware(TailscaleMiddleware)

    @app.get("/health")
    def health():
        return {"status": "ok"}

    @app.get("/api/v1/setup/status")
    def setup_status():
        return {"is_initialized": True}

    return app


class TestTailscaleMiddleware:
    def test_non_tailscale_client_gets_403_not_500(self, guarded_app):
        client = TestClient(guarded_app, client=("192.168.1.50", 50000))

        response = client.get("/api/v1/setup/status")

        assert response.status_code == 403
        assert "only accessible via Tailscale" in response.json()["detail"]

    def test_tailscale_client_passes(self, guarded_app):
        client = TestClient(guarded_app, client=("100.100.1.1", 50000))

        assert client.get("/api/v1/setup/status").json() == {"is_initialized": True}

    def test_health_is_exempt(self, guarded_app):
        client = TestClient(guarded_app, client=("192.168.1.50", 50000))

        assert client.get("/health").status_code == 200


class TestIsTailscaleIP:
    """Test Tailscale IP detection."""

    def test_tailscale_ip_valid(self):
        """Test that Tailscale CGNAT IPs are detected."""
        # Tailscale uses 100.64.0.0/10 (CGNAT range)
        assert is_tailscale_ip("100.64.0.1") is True
        assert is_tailscale_ip("100.100.100.100") is True
        assert is_tailscale_ip("100.127.255.255") is True

    def test_tailscale_ip_boundary(self):
        """Test boundary IPs."""
        # Lower boundary of 100.64.0.0/10
        assert is_tailscale_ip("100.64.0.0") is True
        # Upper boundary
        assert is_tailscale_ip("100.127.255.255") is True

    def test_non_tailscale_ip(self):
        """Test that non-Tailscale IPs are rejected."""
        assert is_tailscale_ip("192.168.1.1") is False
        assert is_tailscale_ip("10.0.0.1") is False
        assert is_tailscale_ip("172.16.0.1") is False
        assert is_tailscale_ip("8.8.8.8") is False
        assert is_tailscale_ip("127.0.0.1") is False

    def test_edge_cases(self):
        """Test edge cases outside Tailscale range."""
        # Just below the range
        assert is_tailscale_ip("100.63.255.255") is False
        # Just above the range
        assert is_tailscale_ip("100.128.0.0") is False

    def test_invalid_ip(self):
        """Test that invalid IPs return False."""
        assert is_tailscale_ip("not.an.ip") is False
        assert is_tailscale_ip("") is False
        assert is_tailscale_ip("256.256.256.256") is False

    def test_ipv6(self):
        """Test IPv6 addresses (not Tailscale)."""
        assert is_tailscale_ip("::1") is False
        assert is_tailscale_ip("2001:db8::1") is False


class TestGetClientIP:
    """Client IP extraction (re-exported from app.core.client_ip)."""

    def test_trusted_peer_walks_forwarded_chain(self):
        """Behind a trusted proxy the hop it appended is used, not the client's own entry."""
        request = MagicMock()
        request.headers = {"X-Forwarded-For": "203.0.113.9, 100.100.1.1, 10.0.0.2"}
        request.client = MagicMock(host="10.0.0.1")

        assert get_client_ip(request, TRUSTED) == "100.100.1.1"

    def test_untrusted_peer_ignores_forwarded_for(self):
        """A direct LAN client cannot claim a Tailscale address via headers."""
        request = MagicMock()
        request.headers = {"X-Forwarded-For": "100.100.1.1"}
        request.client = MagicMock(host="192.168.1.50")

        assert get_client_ip(request, TRUSTED) == "192.168.1.50"

    def test_x_real_ip_is_ignored(self):
        request = MagicMock()
        request.headers = {"X-Real-IP": "100.100.1.1"}
        request.client = MagicMock(host="10.0.0.1")

        assert get_client_ip(request, TRUSTED) == "10.0.0.1"

    def test_get_ip_from_client(self):
        """Test extracting IP directly from client."""
        request = MagicMock()
        request.headers = {}
        request.client = MagicMock(host="100.100.1.1")

        assert get_client_ip(request, TRUSTED) == "100.100.1.1"

    def test_get_ip_no_client(self):
        """Test when no client IP is available."""
        request = MagicMock()
        request.headers = {}
        request.client = None

        assert get_client_ip(request, TRUSTED) == ""


class TestGetTailscaleUserInfo:
    """Test Tailscale user info extraction."""

    def test_get_user_info_full(self):
        """Test extracting full user info from headers."""
        request = MagicMock()
        request.headers = {
            "Tailscale-User-Login": "user@example.com",
            "Tailscale-User-Name": "Test User",
            "Tailscale-User-Profile-Pic": "https://example.com/pic.jpg",
        }

        info = get_tailscale_user_info(request)

        assert info is not None
        assert info["login"] == "user@example.com"
        assert info["name"] == "Test User"
        assert info["profile_pic"] == "https://example.com/pic.jpg"

    def test_get_user_info_partial(self):
        """Test extracting partial user info."""
        request = MagicMock()
        request.headers = {
            "Tailscale-User-Login": "user@example.com",
        }

        info = get_tailscale_user_info(request)

        assert info is not None
        assert info["login"] == "user@example.com"
        assert info["name"] is None
        assert info["profile_pic"] is None

    def test_get_user_info_none(self):
        """Test when no Tailscale headers are present."""
        request = MagicMock()
        request.headers = {}

        info = get_tailscale_user_info(request)

        assert info is None
