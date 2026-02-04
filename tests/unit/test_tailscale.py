"""Tests for Tailscale integration utilities."""

import pytest
from unittest.mock import MagicMock

from app.core.tailscale import (
    get_client_ip,
    get_tailscale_user_info,
    is_tailscale_ip,
)


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
    """Test client IP extraction."""

    def test_get_ip_from_x_forwarded_for(self):
        """Test extracting IP from X-Forwarded-For header."""
        request = MagicMock()
        request.headers = {"X-Forwarded-For": "100.100.1.1, 192.168.1.1"}
        request.client = MagicMock(host="10.0.0.1")

        ip = get_client_ip(request)
        assert ip == "100.100.1.1"

    def test_get_ip_from_x_forwarded_for_single(self):
        """Test X-Forwarded-For with single IP."""
        request = MagicMock()
        request.headers = {"X-Forwarded-For": "100.100.1.1"}
        request.client = MagicMock(host="10.0.0.1")

        ip = get_client_ip(request)
        assert ip == "100.100.1.1"

    def test_get_ip_from_x_real_ip(self):
        """Test extracting IP from X-Real-IP header."""
        request = MagicMock()
        request.headers = {"X-Real-IP": "100.100.1.1"}
        request.client = MagicMock(host="10.0.0.1")

        ip = get_client_ip(request)
        assert ip == "100.100.1.1"

    def test_get_ip_from_client(self):
        """Test extracting IP directly from client."""
        request = MagicMock()
        request.headers = {}
        request.client = MagicMock(host="100.100.1.1")

        ip = get_client_ip(request)
        assert ip == "100.100.1.1"

    def test_get_ip_no_client(self):
        """Test when no client IP is available."""
        request = MagicMock()
        request.headers = {}
        request.client = None

        ip = get_client_ip(request)
        assert ip == ""

    def test_x_forwarded_for_priority(self):
        """Test that X-Forwarded-For has priority over X-Real-IP."""
        request = MagicMock()
        request.headers = {
            "X-Forwarded-For": "100.100.1.1",
            "X-Real-IP": "100.100.2.2",
        }
        request.client = MagicMock(host="10.0.0.1")

        ip = get_client_ip(request)
        assert ip == "100.100.1.1"


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
