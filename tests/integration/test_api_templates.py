"""Integration tests for templates API endpoints."""

import pytest
from httpx import AsyncClient

from app.schemas.user import UserCreate
from app.services.user import UserService


class TestTemplatesAPI:
    """Test templates endpoints."""

    async def _create_user_and_login(self, client: AsyncClient, db_session, test_user_data):
        """Helper to create user and get auth token."""
        service = UserService(db_session)
        user_create = UserCreate(**test_user_data)
        await service.create(user_create)
        await db_session.commit()

        login_response = await client.post(
            "/api/v1/auth/login",
            data={
                "username": test_user_data["email"],
                "password": test_user_data["password"],
            },
        )
        return login_response.json()["access_token"]

    @pytest.mark.asyncio
    async def test_create_template(
        self,
        client: AsyncClient,
        db_session,
        test_user_data,
        test_template_data,
    ):
        """Test creating a template."""
        token = await self._create_user_and_login(client, db_session, test_user_data)

        response = await client.post(
            "/api/v1/templates",
            headers={"Authorization": f"Bearer {token}"},
            json=test_template_data,
        )

        assert response.status_code == 201
        data = response.json()
        assert data["name"] == test_template_data["name"]
        assert data["description"] == test_template_data["description"]
        assert data["icon"] == test_template_data["icon"]
        assert data["sync_version"] == 1
        assert data["is_active"] is True
        assert len(data["fields"]) == 3

    @pytest.mark.asyncio
    async def test_create_template_duplicate_name(
        self,
        client: AsyncClient,
        db_session,
        test_user_data,
        test_template_data,
    ):
        """Test creating template with duplicate name fails."""
        token = await self._create_user_and_login(client, db_session, test_user_data)

        # Create first template
        await client.post(
            "/api/v1/templates",
            headers={"Authorization": f"Bearer {token}"},
            json=test_template_data,
        )

        # Try to create duplicate
        response = await client.post(
            "/api/v1/templates",
            headers={"Authorization": f"Bearer {token}"},
            json=test_template_data,
        )

        assert response.status_code == 409
        assert "already exists" in response.json()["detail"]

    @pytest.mark.asyncio
    async def test_list_templates(
        self,
        client: AsyncClient,
        db_session,
        test_user_data,
    ):
        """Test listing templates."""
        token = await self._create_user_and_login(client, db_session, test_user_data)

        # Create templates
        for i in range(3):
            await client.post(
                "/api/v1/templates",
                headers={"Authorization": f"Bearer {token}"},
                json={
                    "name": f"Template {i}",
                    "fields": [{"key": "field", "isSecret": False}],
                },
            )

        response = await client.get(
            "/api/v1/templates",
            headers={"Authorization": f"Bearer {token}"},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 3
        assert len(data["templates"]) == 3

    @pytest.mark.asyncio
    async def test_list_templates_filter_by_category(
        self,
        client: AsyncClient,
        db_session,
        test_user_data,
    ):
        """Test filtering templates by category."""
        token = await self._create_user_and_login(client, db_session, test_user_data)

        # Create templates in different categories
        for i, category in enumerate(["dev", "dev", "finance"]):
            await client.post(
                "/api/v1/templates",
                headers={"Authorization": f"Bearer {token}"},
                json={
                    "name": f"Template {i}",
                    "category": category,
                    "fields": [{"key": "field", "isSecret": False}],
                },
            )

        response = await client.get(
            "/api/v1/templates",
            headers={"Authorization": f"Bearer {token}"},
            params={"category": "dev"},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 2

    @pytest.mark.asyncio
    async def test_get_template(
        self,
        client: AsyncClient,
        db_session,
        test_user_data,
        test_template_data,
    ):
        """Test getting a specific template."""
        token = await self._create_user_and_login(client, db_session, test_user_data)

        create_response = await client.post(
            "/api/v1/templates",
            headers={"Authorization": f"Bearer {token}"},
            json=test_template_data,
        )
        template_id = create_response.json()["id"]

        response = await client.get(
            f"/api/v1/templates/{template_id}",
            headers={"Authorization": f"Bearer {token}"},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["id"] == template_id
        assert data["name"] == test_template_data["name"]

    @pytest.mark.asyncio
    async def test_get_template_not_found(
        self,
        client: AsyncClient,
        db_session,
        test_user_data,
    ):
        """Test getting non-existent template returns 404."""
        token = await self._create_user_and_login(client, db_session, test_user_data)

        response = await client.get(
            "/api/v1/templates/non-existent-id",
            headers={"Authorization": f"Bearer {token}"},
        )

        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_update_template(
        self,
        client: AsyncClient,
        db_session,
        test_user_data,
        test_template_data,
    ):
        """Test updating a template."""
        token = await self._create_user_and_login(client, db_session, test_user_data)

        create_response = await client.post(
            "/api/v1/templates",
            headers={"Authorization": f"Bearer {token}"},
            json=test_template_data,
        )
        template_id = create_response.json()["id"]

        response = await client.patch(
            f"/api/v1/templates/{template_id}",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "name": "Updated Name",
                "sync_version": 1,
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["name"] == "Updated Name"
        assert data["sync_version"] == 2

    @pytest.mark.asyncio
    async def test_update_template_version_conflict(
        self,
        client: AsyncClient,
        db_session,
        test_user_data,
        test_template_data,
    ):
        """Test update with wrong version returns 409."""
        token = await self._create_user_and_login(client, db_session, test_user_data)

        create_response = await client.post(
            "/api/v1/templates",
            headers={"Authorization": f"Bearer {token}"},
            json=test_template_data,
        )
        template_id = create_response.json()["id"]

        # First update succeeds
        await client.patch(
            f"/api/v1/templates/{template_id}",
            headers={"Authorization": f"Bearer {token}"},
            json={"name": "Update 1", "sync_version": 1},
        )

        # Second update with old version fails
        response = await client.patch(
            f"/api/v1/templates/{template_id}",
            headers={"Authorization": f"Bearer {token}"},
            json={"name": "Update 2", "sync_version": 1},
        )

        assert response.status_code == 409
        data = response.json()
        assert data["server_version"] == 2
        assert data["client_version"] == 1
        assert "server_data" in data

    @pytest.mark.asyncio
    async def test_delete_template_soft(
        self,
        client: AsyncClient,
        db_session,
        test_user_data,
        test_template_data,
    ):
        """Test soft deleting a template."""
        token = await self._create_user_and_login(client, db_session, test_user_data)

        create_response = await client.post(
            "/api/v1/templates",
            headers={"Authorization": f"Bearer {token}"},
            json=test_template_data,
        )
        template_id = create_response.json()["id"]

        response = await client.delete(
            f"/api/v1/templates/{template_id}",
            headers={"Authorization": f"Bearer {token}"},
        )

        assert response.status_code == 204

        # Should not appear in normal list
        list_response = await client.get(
            "/api/v1/templates",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert list_response.json()["total"] == 0

        # Should appear with include_inactive
        list_response = await client.get(
            "/api/v1/templates",
            headers={"Authorization": f"Bearer {token}"},
            params={"include_inactive": True},
        )
        assert list_response.json()["total"] == 1

    @pytest.mark.asyncio
    async def test_delete_template_hard(
        self,
        client: AsyncClient,
        db_session,
        test_user_data,
        test_template_data,
    ):
        """Test hard deleting a template."""
        token = await self._create_user_and_login(client, db_session, test_user_data)

        create_response = await client.post(
            "/api/v1/templates",
            headers={"Authorization": f"Bearer {token}"},
            json=test_template_data,
        )
        template_id = create_response.json()["id"]

        response = await client.delete(
            f"/api/v1/templates/{template_id}",
            headers={"Authorization": f"Bearer {token}"},
            params={"hard_delete": True},
        )

        assert response.status_code == 204

        # Should not exist even with include_inactive
        list_response = await client.get(
            "/api/v1/templates",
            headers={"Authorization": f"Bearer {token}"},
            params={"include_inactive": True},
        )
        assert list_response.json()["total"] == 0

    @pytest.mark.asyncio
    async def test_record_usage(
        self,
        client: AsyncClient,
        db_session,
        test_user_data,
        test_template_data,
    ):
        """Test recording template usage."""
        token = await self._create_user_and_login(client, db_session, test_user_data)

        create_response = await client.post(
            "/api/v1/templates",
            headers={"Authorization": f"Bearer {token}"},
            json=test_template_data,
        )
        template_id = create_response.json()["id"]

        response = await client.post(
            f"/api/v1/templates/{template_id}/use",
            headers={"Authorization": f"Bearer {token}"},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["template_id"] == template_id
        assert data["use_count"] == 1

    @pytest.mark.asyncio
    async def test_get_usage_stats(
        self,
        client: AsyncClient,
        db_session,
        test_user_data,
    ):
        """Test getting usage statistics."""
        token = await self._create_user_and_login(client, db_session, test_user_data)

        # Create templates
        template_ids = []
        for i in range(2):
            create_response = await client.post(
                "/api/v1/templates",
                headers={"Authorization": f"Bearer {token}"},
                json={
                    "name": f"Template {i}",
                    "fields": [{"key": "field", "isSecret": False}],
                },
            )
            template_ids.append(create_response.json()["id"])

        # Record usage
        for _ in range(3):
            await client.post(
                f"/api/v1/templates/{template_ids[0]}/use",
                headers={"Authorization": f"Bearer {token}"},
            )

        await client.post(
            f"/api/v1/templates/{template_ids[1]}/use",
            headers={"Authorization": f"Bearer {token}"},
        )

        response = await client.get(
            "/api/v1/templates/usage/stats",
            headers={"Authorization": f"Bearer {token}"},
        )

        assert response.status_code == 200
        data = response.json()
        assert len(data["usage"]) == 2
        # Sorted by use_count desc
        assert data["usage"][0]["use_count"] == 3
        assert data["usage"][1]["use_count"] == 1

    @pytest.mark.asyncio
    async def test_sync_templates(
        self,
        client: AsyncClient,
        db_session,
        test_user_data,
    ):
        """Test syncing templates from localStorage."""
        token = await self._create_user_and_login(client, db_session, test_user_data)

        response = await client.post(
            "/api/v1/templates/sync",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "templates": [
                    {
                        "local_id": "custom-abc123",
                        "name": "Synced Template 1",
                        "fields": [{"key": "field1", "isSecret": False}],
                    },
                    {
                        "local_id": "custom-def456",
                        "name": "Synced Template 2",
                        "fields": [{"key": "field2", "isSecret": True}],
                    },
                ],
                "usage": [],
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["synced"] == 2
        assert data["skipped"] == 0
        assert "custom-abc123" in data["mapping"]
        assert "custom-def456" in data["mapping"]

    @pytest.mark.asyncio
    async def test_template_isolation(
        self,
        client: AsyncClient,
        db_session,
        test_user_data,
        test_template_data,
    ):
        """Test that users cannot access each other's templates."""
        # Create first user and template
        token1 = await self._create_user_and_login(client, db_session, test_user_data)

        create_response = await client.post(
            "/api/v1/templates",
            headers={"Authorization": f"Bearer {token1}"},
            json=test_template_data,
        )
        template_id = create_response.json()["id"]

        # Create second user
        user2_data = {
            "email": "user2@example.com",
            "display_name": "User 2",
            "password": "Password123!",
        }
        service = UserService(db_session)
        user_create = UserCreate(**user2_data)
        await service.create(user_create)
        await db_session.commit()

        login2_response = await client.post(
            "/api/v1/auth/login",
            data={"username": user2_data["email"], "password": user2_data["password"]},
        )
        token2 = login2_response.json()["access_token"]

        # User 2 should not be able to access User 1's template
        response = await client.get(
            f"/api/v1/templates/{template_id}",
            headers={"Authorization": f"Bearer {token2}"},
        )

        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_unauthorized_access(
        self,
        client: AsyncClient,
    ):
        """Test that unauthenticated requests are rejected."""
        response = await client.get("/api/v1/templates/")
        assert response.status_code == 401
