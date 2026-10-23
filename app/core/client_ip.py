"""Resolve the real client address behind trusted reverse proxies.

Only ``X-Forwarded-For`` is consulted, and only when the direct peer is one
of the configured trusted proxies (``TRUSTED_PROXIES``). The chain is walked
from the right, which is the hop appended by the nearest proxy, towards the
left, skipping trusted hops, so a value the client supplied itself is never
used. ``X-Real-IP`` is ignored: it is a single overwritable header with no
chain semantics.

Deployment chain this is designed for::

    tailnet client (100.x) -> tailscale sidecar (172.x) -> nginx (172.x) -> backend

nginx appends the sidecal's address with ``proxy_add_x_forwarded_for``; the
sidecar sets the tailnet address. Walking from the right skips both proxies
and lands on the tailnet address. A request that reaches nginx or the
backend directly from a LAN address has an untrusted peer, so its forwarded
header is ignored and the LAN address itself is used.
"""

import ipaddress
import logging
from collections.abc import Iterable
from functools import lru_cache

from fastapi import Request

from app.config import get_settings

logger = logging.getLogger(__name__)

IPNetwork = ipaddress.IPv4Network | ipaddress.IPv6Network


@lru_cache(maxsize=8)
def parse_networks(spec: str) -> tuple[IPNetwork, ...]:
    """Parse a comma-separated list of CIDRs; invalid entries are logged and skipped."""
    networks: list[IPNetwork] = []
    for raw in spec.split(","):
        item = raw.strip()
        if not item:
            continue
        try:
            networks.append(ipaddress.ip_network(item, strict=False))
        except ValueError:
            logger.warning("Ignoring invalid TRUSTED_PROXIES entry: %r", item)
    return tuple(networks)


def _parse_ip(value: str) -> ipaddress.IPv4Address | ipaddress.IPv6Address | None:
    try:
        return ipaddress.ip_address(value)
    except ValueError:
        return None


def is_trusted_proxy(ip: str, networks: Iterable[IPNetwork]) -> bool:
    """True when ``ip`` falls inside one of the trusted proxy networks."""
    addr = _parse_ip(ip)
    if addr is None:
        return False
    return any(addr in net for net in networks)


def trusted_proxy_networks() -> tuple[IPNetwork, ...]:
    """Trusted proxy networks from settings (parsed once per distinct value)."""
    return parse_networks(get_settings().trusted_proxies)


def get_client_ip(
    request: Request,
    trusted_networks: Iterable[IPNetwork] | None = None,
) -> str:
    """Return the originating client address, or ``""`` when it cannot be determined.

    Args:
        request: Incoming request.
        trusted_networks: Override for the trusted proxy networks (tests);
            defaults to the ``TRUSTED_PROXIES`` setting.
    """
    peer = request.client.host if request.client else ""
    networks = tuple(trusted_networks) if trusted_networks is not None else trusted_proxy_networks()

    # Untrusted peer: whatever it claims in X-Forwarded-For is just a header.
    if not peer or not is_trusted_proxy(peer, networks):
        return peer

    forwarded = request.headers.get("X-Forwarded-For") or ""
    hops = [hop.strip() for hop in forwarded.split(",") if hop.strip()]

    for hop in reversed(hops):
        if is_trusted_proxy(hop, networks):
            continue
        # First untrusted hop from the right is the address the nearest
        # trusted proxy saw. Anything that is not an IP is garbage the client
        # put there; report unknown rather than propagate it into logs/keys.
        return hop if _parse_ip(hop) is not None else ""

    # Every hop was a trusted proxy (or there was no header at all).
    return hops[0] if hops else peer
