"""Template service for business logic."""

from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.template import Template
from app.models.template_usage import TemplateUsage
from app.schemas.template import (
    SyncRequest,
    SyncResponse,
    SyncTemplateItem,
    TemplateCreate,
    TemplateUpdate,
    TemplateUsageStats,
)


class VersionConflictError(Exception):
    """Raised when template version conflicts during update."""

    def __init__(self, server_version: int, client_version: int, template: Template):
        self.server_version = server_version
        self.client_version = client_version
        self.template = template
        super().__init__(f"Version conflict: server={server_version}, client={client_version}")


class TemplateService:
    """Service for template operations."""

    def __init__(self, db: AsyncSession):
        self.db = db

    # ==================== CRUD Operations ====================

    async def get_by_id(self, template_id: str, owner_id: str) -> Template | None:
        """Get template by ID (only if owned by user)."""
        result = await self.db.execute(
            select(Template).where(
                Template.id == template_id,
                Template.owner_id == owner_id,
            )
        )
        return result.scalar_one_or_none()

    async def get_by_name(self, name: str, owner_id: str) -> Template | None:
        """Get template by name (for uniqueness check)."""
        result = await self.db.execute(
            select(Template).where(
                Template.name == name,
                Template.owner_id == owner_id,
            )
        )
        return result.scalar_one_or_none()

    async def list_by_owner(
        self,
        owner_id: str,
        skip: int = 0,
        limit: int = 100,
        category: str | None = None,
        include_inactive: bool = False,
    ) -> list[Template]:
        """List all templates for a user."""
        query = select(Template).where(Template.owner_id == owner_id)

        if not include_inactive:
            query = query.where(Template.is_active == True)  # noqa: E712

        if category:
            query = query.where(Template.category == category)

        query = query.offset(skip).limit(limit).order_by(Template.created_at.desc())
        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def count_by_owner(
        self,
        owner_id: str,
        include_inactive: bool = False,
        category: str | None = None,
    ) -> int:
        """Count templates for a user."""
        query = select(func.count(Template.id)).where(Template.owner_id == owner_id)

        if not include_inactive:
            query = query.where(Template.is_active == True)  # noqa: E712

        if category:
            query = query.where(Template.category == category)

        result = await self.db.execute(query)
        return result.scalar() or 0

    async def create(self, owner_id: str, data: TemplateCreate) -> Template:
        """Create a new template."""
        # Convert TemplateField objects to dicts for JSONB storage
        fields_data = [field.model_dump() for field in data.fields]

        template = Template(
            owner_id=owner_id,
            name=data.name,
            description=data.description,
            icon=data.icon,
            category=data.category,
            fields=fields_data,
            sync_version=1,
        )
        self.db.add(template)
        await self.db.flush()
        await self.db.refresh(template)
        return template

    async def update(
        self,
        template: Template,
        data: TemplateUpdate,
    ) -> Template:
        """Update a template with version check.

        Raises:
            VersionConflictError: If client version doesn't match server version.
        """
        # Check version for optimistic locking
        if template.sync_version != data.sync_version:
            raise VersionConflictError(
                server_version=template.sync_version,
                client_version=data.sync_version,
                template=template,
            )

        # Update fields
        update_data = data.model_dump(exclude_unset=True, exclude={"sync_version"})

        # Handle fields separately (convert to dict for JSONB)
        if "fields" in update_data and update_data["fields"] is not None:
            if data.fields is not None:
                update_data["fields"] = [f.model_dump() for f in data.fields]

        for field, value in update_data.items():
            setattr(template, field, value)

        # Increment version
        template.sync_version += 1

        await self.db.flush()
        await self.db.refresh(template)
        return template

    async def soft_delete(self, template: Template) -> Template:
        """Soft delete a template (set is_active = False)."""
        template.is_active = False
        await self.db.flush()
        return template

    async def hard_delete(self, template: Template) -> None:
        """Permanently delete a template."""
        await self.db.delete(template)
        await self.db.flush()

    # ==================== Usage Tracking ====================

    async def record_usage(
        self,
        template_id: str,
        user_id: str,
        credential_id: str | None = None,
    ) -> int:
        """Record template usage. Returns new use count."""
        # Check if usage already recorded for this credential
        if credential_id:
            existing = await self.db.execute(
                select(TemplateUsage).where(
                    TemplateUsage.template_id == template_id,
                    TemplateUsage.credential_id == credential_id,
                )
            )
            if existing.scalar_one_or_none():
                # Already recorded, just return current count
                return await self.get_use_count(template_id)

        usage = TemplateUsage(
            template_id=template_id,
            user_id=user_id,
            credential_id=credential_id,
        )
        self.db.add(usage)
        await self.db.flush()

        return await self.get_use_count(template_id)

    async def get_use_count(self, template_id: str) -> int:
        """Get usage count for a template."""
        result = await self.db.execute(
            select(func.count(TemplateUsage.id)).where(TemplateUsage.template_id == template_id)
        )
        return result.scalar() or 0

    async def get_usage_stats(self, owner_id: str) -> list[TemplateUsageStats]:
        """Get usage statistics for all templates owned by user."""
        # Query: template name, count, last used
        result = await self.db.execute(
            select(
                Template.id,
                Template.name,
                func.count(TemplateUsage.id).label("use_count"),
                func.max(TemplateUsage.used_at).label("last_used_at"),
            )
            .outerjoin(TemplateUsage, Template.id == TemplateUsage.template_id)
            .where(
                Template.owner_id == owner_id,
                Template.is_active == True,  # noqa: E712
            )
            .group_by(Template.id, Template.name)
            .order_by(func.count(TemplateUsage.id).desc())
        )

        stats = []
        for row in result.all():
            stats.append(
                TemplateUsageStats(
                    template_id=row.id,
                    template_name=row.name,
                    use_count=row.use_count,
                    last_used_at=row.last_used_at,
                )
            )
        return stats

    # ==================== Sync/Migration ====================

    async def batch_sync(
        self,
        owner_id: str,
        data: SyncRequest,
    ) -> SyncResponse:
        """Sync templates from localStorage to backend.

        Skips templates with names that already exist.
        Returns mapping from local_id to server UUID.
        """
        synced = 0
        skipped = 0
        mapping: dict[str, str] = {}

        for item in data.templates:
            # Check if template with same name exists
            existing = await self.get_by_name(item.name, owner_id)
            if existing:
                skipped += 1
                # Map to existing template
                mapping[item.local_id] = existing.id
                continue

            # Create new template
            template = await self._create_from_sync_item(owner_id, item)
            mapping[item.local_id] = template.id
            synced += 1

        # Sync usage records
        for usage_item in data.usage:
            server_template_id = mapping.get(usage_item.local_template_id)
            if server_template_id:
                await self._record_synced_usage(
                    template_id=server_template_id,
                    user_id=owner_id,
                    used_at=usage_item.used_at,
                )

        return SyncResponse(
            synced=synced,
            skipped=skipped,
            mapping=mapping,
        )

    async def _create_from_sync_item(
        self,
        owner_id: str,
        item: SyncTemplateItem,
    ) -> Template:
        """Create template from sync item."""
        fields_data = [field.model_dump() for field in item.fields]

        template = Template(
            owner_id=owner_id,
            name=item.name,
            description=item.description,
            icon=item.icon,
            category=item.category,
            fields=fields_data,
            sync_version=1,
        )

        # Preserve original created_at if provided
        if item.created_at:
            template.created_at = item.created_at

        self.db.add(template)
        await self.db.flush()
        await self.db.refresh(template)
        return template

    async def _record_synced_usage(
        self,
        template_id: str,
        user_id: str,
        used_at: datetime,
    ) -> None:
        """Record usage from sync with original timestamp."""
        usage = TemplateUsage(
            template_id=template_id,
            user_id=user_id,
            credential_id=None,  # No credential ID for synced usage
        )
        # Override used_at with synced timestamp
        self.db.add(usage)
        await self.db.flush()

        # Update the used_at to the synced value
        usage.used_at = used_at
        await self.db.flush()
