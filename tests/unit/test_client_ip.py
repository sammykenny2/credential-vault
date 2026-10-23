"""Tests for trusted-proxy client IP resolution."""

from unittest.mock import MagicMock

from app.core.client_ip import get_client_ip, is_trusted_proxy, parse_networks

DOCKER = parse_networks("127.0.0.1/32,::1/128,172.16.0.0/12")


def _request(peer: str | None, **headers: str) -> MagicMock:
    request = MagicMock()
    request.headers = headers
    request.client = MagicMock(host=peer) if peer is not None else None
    return request


class TestParseNetworks:
    def test_parses_cidrs_and_skips_garbage(self):
        nets = parse_networks("10.0.0.0/8, not-a-network ,::1/128,,192.168.1.0/24")
        assert [str(n) for n in nets] == ["10.0.0.0/8", "::1/128", "192.168.1.0/24"]

    def test_empty_spec(self):
        assert parse_networks("") == ()

    def test_is_trusted_proxy(self):
        assert is_trusted_proxy("172.18.0.5", DOCKER) is True
        assert is_trusted_proxy("127.0.0.1", DOCKER) is True
        assert is_trusted_proxy("192.168.1.10", DOCKER) is False
        assert is_trusted_proxy("garbage", DOCKER) is False


class TestGetClientIP:
    def test_untrusted_peer_ignores_forwarded_header(self):
        """A LAN client cannot spoof a tailnet address by sending X-Forwarded-For."""
        request = _request("192.168.1.50", **{"X-Forwarded-For": "100.100.1.1"})
        assert get_client_ip(request, DOCKER) == "192.168.1.50"

    def test_trusted_peer_uses_hop_appended_by_proxy(self):
        """nginx appends the sidecar; the sidecar set the tailnet address."""
        request = _request("172.18.0.3", **{"X-Forwarded-For": "100.100.1.1, 172.18.0.2"})
        assert get_client_ip(request, DOCKER) == "100.100.1.1"

    def test_client_supplied_prefix_is_skipped(self):
        """A spoofed leading entry is ignored because the walk starts from the right."""
        request = _request(
            "172.18.0.3", **{"X-Forwarded-For": "100.64.9.9, 203.0.113.7, 172.18.0.2"}
        )
        assert get_client_ip(request, DOCKER) == "203.0.113.7"

    def test_direct_from_sidecar(self):
        """Tailscale Serve routes /api straight to the backend without nginx."""
        request = _request("172.18.0.2", **{"X-Forwarded-For": "100.100.1.1"})
        assert get_client_ip(request, DOCKER) == "100.100.1.1"

    def test_trusted_peer_without_header_returns_peer(self):
        request = _request("127.0.0.1")
        assert get_client_ip(request, DOCKER) == "127.0.0.1"

    def test_all_hops_trusted_returns_leftmost(self):
        request = _request("172.18.0.3", **{"X-Forwarded-For": "172.18.0.9, 172.18.0.2"})
        assert get_client_ip(request, DOCKER) == "172.18.0.9"

    def test_garbage_hop_reports_unknown(self):
        request = _request("172.18.0.3", **{"X-Forwarded-For": "<script>, 172.18.0.2"})
        assert get_client_ip(request, DOCKER) == ""

    def test_x_real_ip_is_never_trusted(self):
        request = _request("172.18.0.3", **{"X-Real-IP": "100.100.1.1"})
        assert get_client_ip(request, DOCKER) == "172.18.0.3"

    def test_no_client(self):
        assert get_client_ip(_request(None), DOCKER) == ""

    def test_default_networks_cover_loopback_and_docker_bridge(self):
        """Without an override the TRUSTED_PROXIES default applies."""
        request = _request("127.0.0.1", **{"X-Forwarded-For": "100.100.1.1"})
        assert get_client_ip(request) == "100.100.1.1"
        request = _request("192.168.1.50", **{"X-Forwarded-For": "100.100.1.1"})
        assert get_client_ip(request) == "192.168.1.50"
