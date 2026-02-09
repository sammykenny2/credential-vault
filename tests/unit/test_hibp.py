"""Tests for HIBP breach detection."""

import hashlib
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.core.hibp import check_password_breach


class TestHIBPBreachCheck:
    """Tests for check_password_breach function."""

    @pytest.mark.asyncio
    async def test_breached_password(self):
        """Test detection of a known breached password."""
        password = "password123"
        sha1 = hashlib.sha1(password.encode()).hexdigest().upper()
        suffix = sha1[5:]

        mock_response = MagicMock()
        mock_response.text = f"{suffix}:1234\nABCDE12345678901234567890123456:5\n"
        mock_response.raise_for_status = MagicMock()

        with patch("app.core.hibp.httpx.AsyncClient") as mock_client:
            mock_instance = AsyncMock()
            mock_instance.get = AsyncMock(return_value=mock_response)
            mock_instance.__aenter__ = AsyncMock(return_value=mock_instance)
            mock_instance.__aexit__ = AsyncMock(return_value=False)
            mock_client.return_value = mock_instance

            result = await check_password_breach(password)

        assert result["breached"] is True
        assert result["count"] == 1234
        assert result["error"] is None

    @pytest.mark.asyncio
    async def test_safe_password(self):
        """Test a password not found in breaches."""
        password = "unique_super_secret_2024_xyz"
        hashlib.sha1(password.encode()).hexdigest().upper()

        # Return results that don't match
        mock_response = MagicMock()
        mock_response.text = (
            "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA:100\nBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB:50\n"
        )
        mock_response.raise_for_status = MagicMock()

        with patch("app.core.hibp.httpx.AsyncClient") as mock_client:
            mock_instance = AsyncMock()
            mock_instance.get = AsyncMock(return_value=mock_response)
            mock_instance.__aenter__ = AsyncMock(return_value=mock_instance)
            mock_instance.__aexit__ = AsyncMock(return_value=False)
            mock_client.return_value = mock_instance

            result = await check_password_breach(password)

        assert result["breached"] is False
        assert result["count"] == 0
        assert result["error"] is None

    @pytest.mark.asyncio
    async def test_api_timeout(self):
        """Test handling of API timeout."""
        import httpx

        with patch("app.core.hibp.httpx.AsyncClient") as mock_client:
            mock_instance = AsyncMock()
            mock_instance.get = AsyncMock(side_effect=httpx.TimeoutException("timeout"))
            mock_instance.__aenter__ = AsyncMock(return_value=mock_instance)
            mock_instance.__aexit__ = AsyncMock(return_value=False)
            mock_client.return_value = mock_instance

            result = await check_password_breach("test")

        assert result["breached"] is False
        assert result["error"] is not None
        assert "timeout" in result["error"].lower()

    @pytest.mark.asyncio
    async def test_api_error(self):
        """Test handling of generic API error."""
        with patch("app.core.hibp.httpx.AsyncClient") as mock_client:
            mock_instance = AsyncMock()
            mock_instance.get = AsyncMock(side_effect=Exception("Connection error"))
            mock_instance.__aenter__ = AsyncMock(return_value=mock_instance)
            mock_instance.__aexit__ = AsyncMock(return_value=False)
            mock_client.return_value = mock_instance

            result = await check_password_breach("test")

        assert result["breached"] is False
        assert result["error"] is not None
