"""Integration tests for feature stub routes (503 responses)."""

import pytest
from httpx import AsyncClient


class TestFeatureStubs:
    """Test that removed features return 503 with roadmap messages."""

    @pytest.mark.asyncio
    async def test_sharing_stub(self, client: AsyncClient):
        """Test sharing endpoints return 503."""
        response = await client.get("/api/v1/sharing")
        assert response.status_code == 503
        assert "temporarily offline" in response.json()["detail"]

    @pytest.mark.asyncio
    async def test_sharing_stub_subpath(self, client: AsyncClient):
        """Test sharing subpath returns 503."""
        response = await client.post("/api/v1/sharing/some/path")
        assert response.status_code == 503

    @pytest.mark.asyncio
    async def test_emergency_stub(self, client: AsyncClient):
        """Test emergency access endpoints return 503."""
        response = await client.get("/api/v1/emergency")
        assert response.status_code == 503
        assert "temporarily offline" in response.json()["detail"]

    @pytest.mark.asyncio
    async def test_backup_stub(self, client: AsyncClient):
        """Test backup endpoints return 503."""
        response = await client.get("/api/v1/backup")
        assert response.status_code == 503
        assert "temporarily offline" in response.json()["detail"]

    @pytest.mark.asyncio
    async def test_totp_stub(self, client: AsyncClient):
        """Test TOTP endpoints return 503."""
        response = await client.get("/api/v1/totp")
        assert response.status_code == 503
        assert "temporarily offline" in response.json()["detail"]

    @pytest.mark.asyncio
    async def test_webauthn_stub(self, client: AsyncClient):
        """WebAuthn endpoints are stubbed until a verified implementation exists."""
        response = await client.get("/api/v1/webauthn/credentials")
        assert response.status_code == 503
        assert "temporarily offline" in response.json()["detail"]

        response = await client.post("/api/v1/webauthn/register/options", json={})
        assert response.status_code == 503

    @pytest.mark.asyncio
    async def test_stub_methods(self, client: AsyncClient):
        """Test stubs respond to multiple HTTP methods."""
        for method in ["get", "post", "put", "patch", "delete"]:
            fn = getattr(client, method)
            response = await fn("/api/v1/sharing")
            assert response.status_code == 503, f"{method.upper()} /sharing should return 503"
