"""Add templates and template_usage tables.

Revision ID: 001_add_templates
Revises:
Create Date: 2025-02-05

"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "001_add_templates"
down_revision: str | None = "4fb6de6f44db"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create templates and template_usage tables."""
    # Create templates table
    op.create_table(
        "templates",
        sa.Column("id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("owner_id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("icon", sa.String(50), nullable=True),
        sa.Column("category", sa.String(50), nullable=True),
        sa.Column("fields", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("sync_version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(
            ["owner_id"],
            ["users.id"],
            name="fk_templates_owner_id",
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint("owner_id", "name", name="uq_template_owner_name"),
    )
    op.create_index("ix_templates_owner_id", "templates", ["owner_id"])
    op.create_index("ix_templates_category", "templates", ["category"])

    # Create template_usage table
    op.create_table(
        "template_usage",
        sa.Column("id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("template_id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("credential_id", postgresql.UUID(as_uuid=False), nullable=True),
        sa.Column(
            "used_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(
            ["template_id"],
            ["templates.id"],
            name="fk_template_usage_template_id",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name="fk_template_usage_user_id",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["credential_id"],
            ["credentials.id"],
            name="fk_template_usage_credential_id",
            ondelete="SET NULL",
        ),
        sa.UniqueConstraint("template_id", "credential_id", name="uq_template_credential_usage"),
    )
    op.create_index("ix_template_usage_template_id", "template_usage", ["template_id"])
    op.create_index("ix_template_usage_user_id", "template_usage", ["user_id"])


def downgrade() -> None:
    """Drop templates and template_usage tables."""
    # Drop template_usage table first (has FK to templates)
    op.drop_index("ix_template_usage_user_id", table_name="template_usage")
    op.drop_index("ix_template_usage_template_id", table_name="template_usage")
    op.drop_table("template_usage")

    # Drop templates table
    op.drop_index("ix_templates_category", table_name="templates")
    op.drop_index("ix_templates_owner_id", table_name="templates")
    op.drop_table("templates")
