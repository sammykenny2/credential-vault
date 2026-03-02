"""Stub routes for temporarily offline features.

These features were removed during the E2EE migration and will be
re-implemented with E2EE compatibility in future releases.
"""

from fastapi import APIRouter, HTTPException, status

router = APIRouter()

OFFLINE_MSG = {
    "sharing": (
        "Credential sharing is temporarily offline. "
        "E2EE-compatible sharing (re-encrypt with recipient's public key) is on the roadmap."
    ),
    "emergency": (
        "Emergency access is temporarily offline. "
        "E2EE-compatible emergency access (pre-shared key escrow) is on the roadmap."
    ),
    "backup": (
        "Server-side backup is temporarily offline. "
        "Client-side encrypted export/import is available. Full backup feature is on the roadmap."
    ),
    "totp": (
        "TOTP authenticator is temporarily offline. "
        "Integration with E2EE architecture is on the roadmap."
    ),
}


def _raise_503(feature: str) -> None:
    raise HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail=OFFLINE_MSG[feature],
    )


@router.api_route(
    "/sharing/{path:path}",
    methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    include_in_schema=False,
)
async def sharing_stub(path: str = "") -> None:
    _raise_503("sharing")


@router.api_route(
    "/sharing",
    methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    include_in_schema=False,
)
async def sharing_stub_root() -> None:
    _raise_503("sharing")


@router.api_route(
    "/emergency/{path:path}",
    methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    include_in_schema=False,
)
async def emergency_stub(path: str = "") -> None:
    _raise_503("emergency")


@router.api_route(
    "/emergency",
    methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    include_in_schema=False,
)
async def emergency_stub_root() -> None:
    _raise_503("emergency")


@router.api_route(
    "/backup/{path:path}",
    methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    include_in_schema=False,
)
async def backup_stub(path: str = "") -> None:
    _raise_503("backup")


@router.api_route(
    "/backup",
    methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    include_in_schema=False,
)
async def backup_stub_root() -> None:
    _raise_503("backup")


@router.api_route(
    "/totp/{path:path}",
    methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    include_in_schema=False,
)
async def totp_stub(path: str = "") -> None:
    _raise_503("totp")


@router.api_route(
    "/totp",
    methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    include_in_schema=False,
)
async def totp_stub_root() -> None:
    _raise_503("totp")
