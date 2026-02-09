"""Tests for TemplateService."""

from datetime import UTC

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
from app.schemas.template import (
    SyncRequest,
    SyncTemplateItem,
    SyncUsageItem,
    TemplateCreate,
    TemplateField,
    TemplateUpdate,
)
from app.schemas.user import UserCreate
from app.services.template import TemplateService, VersionConflictError
from app.services.user import UserService


class TestTemplateService:
    """Test TemplateService functions."""

    @pytest_asyncio.fixture
    async def test_user(self, db_session: AsyncSession, test_user_data) -> User:
        """Create a test user for template tests."""
        service = UserService(db_session)
        user_create = UserCreate(**test_user_data)
        return await service.create(user_create)

    @pytest.mark.asyncio
    async def test_create_template(
        self,
        db_session: AsyncSession,
        test_user: User,
        test_template_data,
    ):
        """Test creating a new template."""
        service = TemplateService(db_session)

        template_create = TemplateCreate(
            name=test_template_data["name"],
            description=test_template_data["description"],
            icon=test_template_data["icon"],
            category=test_template_data["category"],
            fields=[TemplateField(**f) for f in test_template_data["fields"]],
        )

        template = await service.create(test_user.id, template_create)

        assert template.id is not None
        assert template.owner_id == test_user.id
        assert template.name == test_template_data["name"]
        assert template.sync_version == 1
        assert template.is_active is True
        assert len(template.fields) == 3

    @pytest.mark.asyncio
    async def test_get_template_by_id(
        self,
        db_session: AsyncSession,
        test_user: User,
        test_template_data,
    ):
        """Test fetching a template by ID."""
        service = TemplateService(db_session)

        template_create = TemplateCreate(
            name=test_template_data["name"],
            fields=[TemplateField(**f) for f in test_template_data["fields"]],
        )
        created = await service.create(test_user.id, template_create)

        fetched = await service.get_by_id(created.id, test_user.id)

        assert fetched is not None
        assert fetched.id == created.id
        assert fetched.name == test_template_data["name"]

    @pytest.mark.asyncio
    async def test_get_template_wrong_owner(
        self,
        db_session: AsyncSession,
        test_user: User,
        test_template_data,
    ):
        """Test that templates cannot be accessed by wrong owner."""
        service = TemplateService(db_session)

        template_create = TemplateCreate(
            name=test_template_data["name"],
            fields=[TemplateField(**f) for f in test_template_data["fields"]],
        )
        created = await service.create(test_user.id, template_create)

        fetched = await service.get_by_id(created.id, "different-user-id")

        assert fetched is None

    @pytest.mark.asyncio
    async def test_get_template_by_name(
        self,
        db_session: AsyncSession,
        test_user: User,
        test_template_data,
    ):
        """Test fetching a template by name."""
        service = TemplateService(db_session)

        template_create = TemplateCreate(
            name=test_template_data["name"],
            fields=[TemplateField(**f) for f in test_template_data["fields"]],
        )
        created = await service.create(test_user.id, template_create)

        fetched = await service.get_by_name(test_template_data["name"], test_user.id)

        assert fetched is not None
        assert fetched.id == created.id

    @pytest.mark.asyncio
    async def test_list_templates(
        self,
        db_session: AsyncSession,
        test_user: User,
    ):
        """Test listing templates."""
        service = TemplateService(db_session)

        # Create multiple templates
        for i in range(3):
            template_create = TemplateCreate(
                name=f"Template {i}",
                fields=[TemplateField(key="field", isSecret=False)],
            )
            await service.create(test_user.id, template_create)

        templates = await service.list_by_owner(test_user.id)

        assert len(templates) == 3

    @pytest.mark.asyncio
    async def test_list_templates_by_category(
        self,
        db_session: AsyncSession,
        test_user: User,
    ):
        """Test filtering templates by category."""
        service = TemplateService(db_session)

        # Create templates in different categories
        for i, category in enumerate(["dev", "dev", "finance"]):
            template_create = TemplateCreate(
                name=f"Template {category} {i}",
                category=category,
                fields=[TemplateField(key="field", isSecret=False)],
            )
            await service.create(test_user.id, template_create)

        dev_templates = await service.list_by_owner(test_user.id, category="dev")

        assert len(dev_templates) == 2

    @pytest.mark.asyncio
    async def test_update_template(
        self,
        db_session: AsyncSession,
        test_user: User,
        test_template_data,
    ):
        """Test updating a template."""
        service = TemplateService(db_session)

        template_create = TemplateCreate(
            name=test_template_data["name"],
            fields=[TemplateField(**f) for f in test_template_data["fields"]],
        )
        template = await service.create(test_user.id, template_create)

        update_data = TemplateUpdate(
            name="Updated Name",
            sync_version=1,
        )
        updated = await service.update(template, update_data)

        assert updated.name == "Updated Name"
        assert updated.sync_version == 2

    @pytest.mark.asyncio
    async def test_update_template_version_conflict(
        self,
        db_session: AsyncSession,
        test_user: User,
        test_template_data,
    ):
        """Test that version conflict raises error."""
        service = TemplateService(db_session)

        template_create = TemplateCreate(
            name=test_template_data["name"],
            fields=[TemplateField(**f) for f in test_template_data["fields"]],
        )
        template = await service.create(test_user.id, template_create)

        # First update succeeds
        update1 = TemplateUpdate(name="Update 1", sync_version=1)
        await service.update(template, update1)

        # Second update with old version fails
        update2 = TemplateUpdate(name="Update 2", sync_version=1)

        with pytest.raises(VersionConflictError) as exc_info:
            await service.update(template, update2)

        assert exc_info.value.server_version == 2
        assert exc_info.value.client_version == 1

    @pytest.mark.asyncio
    async def test_soft_delete_template(
        self,
        db_session: AsyncSession,
        test_user: User,
        test_template_data,
    ):
        """Test soft deleting a template."""
        service = TemplateService(db_session)

        template_create = TemplateCreate(
            name=test_template_data["name"],
            fields=[TemplateField(**f) for f in test_template_data["fields"]],
        )
        template = await service.create(test_user.id, template_create)

        await service.soft_delete(template)

        assert template.is_active is False

        # Should not appear in normal list
        templates = await service.list_by_owner(test_user.id)
        assert len(templates) == 0

        # Should appear with include_inactive
        templates = await service.list_by_owner(test_user.id, include_inactive=True)
        assert len(templates) == 1

    @pytest.mark.asyncio
    async def test_hard_delete_template(
        self,
        db_session: AsyncSession,
        test_user: User,
        test_template_data,
    ):
        """Test hard deleting a template."""
        service = TemplateService(db_session)

        template_create = TemplateCreate(
            name=test_template_data["name"],
            fields=[TemplateField(**f) for f in test_template_data["fields"]],
        )
        template = await service.create(test_user.id, template_create)
        template_id = template.id

        await service.hard_delete(template)

        # Should not exist
        fetched = await service.get_by_id(template_id, test_user.id)
        assert fetched is None

    @pytest.mark.asyncio
    async def test_record_usage(
        self,
        db_session: AsyncSession,
        test_user: User,
        test_template_data,
    ):
        """Test recording template usage."""
        service = TemplateService(db_session)

        template_create = TemplateCreate(
            name=test_template_data["name"],
            fields=[TemplateField(**f) for f in test_template_data["fields"]],
        )
        template = await service.create(test_user.id, template_create)

        # Record usage
        count = await service.record_usage(template.id, test_user.id)
        assert count == 1

        # Record again
        count = await service.record_usage(template.id, test_user.id)
        assert count == 2

    @pytest.mark.asyncio
    async def test_record_usage_with_credential(
        self,
        db_session: AsyncSession,
        test_user: User,
        test_template_data,
    ):
        """Test recording usage with credential prevents duplicates."""
        service = TemplateService(db_session)

        template_create = TemplateCreate(
            name=test_template_data["name"],
            fields=[TemplateField(**f) for f in test_template_data["fields"]],
        )
        template = await service.create(test_user.id, template_create)

        # Record usage with credential
        import uuid

        credential_id = uuid.uuid4().hex
        count = await service.record_usage(template.id, test_user.id, credential_id)
        assert count == 1

        # Recording same credential again should not increase count
        count = await service.record_usage(template.id, test_user.id, credential_id)
        assert count == 1

    @pytest.mark.asyncio
    async def test_get_usage_stats(
        self,
        db_session: AsyncSession,
        test_user: User,
    ):
        """Test getting usage statistics."""
        service = TemplateService(db_session)

        # Create templates
        template1_create = TemplateCreate(
            name="Template 1",
            fields=[TemplateField(key="field", isSecret=False)],
        )
        template1 = await service.create(test_user.id, template1_create)

        template2_create = TemplateCreate(
            name="Template 2",
            fields=[TemplateField(key="field", isSecret=False)],
        )
        template2 = await service.create(test_user.id, template2_create)

        # Record usage
        await service.record_usage(template1.id, test_user.id)
        await service.record_usage(template1.id, test_user.id)
        await service.record_usage(template2.id, test_user.id)

        stats = await service.get_usage_stats(test_user.id)

        assert len(stats) == 2
        # Stats should be sorted by use_count desc
        assert stats[0].template_name == "Template 1"
        assert stats[0].use_count == 2
        assert stats[1].template_name == "Template 2"
        assert stats[1].use_count == 1

    @pytest.mark.asyncio
    async def test_batch_sync(
        self,
        db_session: AsyncSession,
        test_user: User,
    ):
        """Test batch syncing templates from localStorage."""
        service = TemplateService(db_session)

        sync_request = SyncRequest(
            templates=[
                SyncTemplateItem(
                    local_id="custom-abc123",
                    name="Synced Template 1",
                    fields=[TemplateField(key="field1", isSecret=False)],
                ),
                SyncTemplateItem(
                    local_id="custom-def456",
                    name="Synced Template 2",
                    fields=[TemplateField(key="field2", isSecret=True)],
                ),
            ],
            usage=[],
        )

        result = await service.batch_sync(test_user.id, sync_request)

        assert result.synced == 2
        assert result.skipped == 0
        assert "custom-abc123" in result.mapping
        assert "custom-def456" in result.mapping

        # Verify templates exist
        templates = await service.list_by_owner(test_user.id)
        assert len(templates) == 2

    @pytest.mark.asyncio
    async def test_batch_sync_skip_duplicates(
        self,
        db_session: AsyncSession,
        test_user: User,
    ):
        """Test that sync skips templates with duplicate names."""
        service = TemplateService(db_session)

        # Create existing template
        existing = TemplateCreate(
            name="Existing Template",
            fields=[TemplateField(key="field", isSecret=False)],
        )
        await service.create(test_user.id, existing)

        # Try to sync template with same name
        sync_request = SyncRequest(
            templates=[
                SyncTemplateItem(
                    local_id="custom-abc123",
                    name="Existing Template",  # Duplicate name
                    fields=[TemplateField(key="other_field", isSecret=False)],
                ),
                SyncTemplateItem(
                    local_id="custom-def456",
                    name="New Template",
                    fields=[TemplateField(key="field", isSecret=False)],
                ),
            ],
            usage=[],
        )

        result = await service.batch_sync(test_user.id, sync_request)

        assert result.synced == 1
        assert result.skipped == 1

    @pytest.mark.asyncio
    async def test_batch_sync_with_usage(
        self,
        db_session: AsyncSession,
        test_user: User,
    ):
        """Test that sync also imports usage records."""
        from datetime import datetime

        service = TemplateService(db_session)

        used_at = datetime.now(UTC)
        sync_request = SyncRequest(
            templates=[
                SyncTemplateItem(
                    local_id="custom-abc123",
                    name="Synced Template",
                    fields=[TemplateField(key="field", isSecret=False)],
                ),
            ],
            usage=[
                SyncUsageItem(
                    local_template_id="custom-abc123",
                    used_at=used_at,
                ),
            ],
        )

        result = await service.batch_sync(test_user.id, sync_request)

        assert result.synced == 1

        # Check usage was recorded
        stats = await service.get_usage_stats(test_user.id)
        assert len(stats) == 1
        assert stats[0].use_count == 1

    @pytest.mark.asyncio
    async def test_count_by_owner(
        self,
        db_session: AsyncSession,
        test_user: User,
    ):
        """Test counting templates."""
        service = TemplateService(db_session)

        # Create templates
        for i in range(3):
            template_create = TemplateCreate(
                name=f"Template {i}",
                fields=[TemplateField(key="field", isSecret=False)],
            )
            await service.create(test_user.id, template_create)

        count = await service.count_by_owner(test_user.id)
        assert count == 3

        # Soft delete one
        templates = await service.list_by_owner(test_user.id)
        await service.soft_delete(templates[0])

        count = await service.count_by_owner(test_user.id)
        assert count == 2

        count = await service.count_by_owner(test_user.id, include_inactive=True)
        assert count == 3
