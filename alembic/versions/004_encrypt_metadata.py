"""Encrypt metadata: drop plaintext metadata columns from credentials.

Revision ID: 004_encrypt_metadata
Revises: 003_e2ee_migration
Create Date: 2026-03-03

Changes:
- Drop name, description, website_url, category columns from credentials table
- All metadata is now stored inside the encrypted_data blob (client-side encryption)
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "004_encrypt_metadata"
down_revision: str | None = "003_e2ee_migration"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_column("credentials", "name")
    op.drop_column("credentials", "description")
    op.drop_column("credentials", "website_url")
    op.drop_column("credentials", "category")


def downgrade() -> None:
    op.add_column(
        "credentials",
        sa.Column("category", sa.String(100), nullable=True),
    )
    op.add_column(
        "credentials",
        sa.Column("website_url", sa.String(2048), nullable=True),
    )
    op.add_column(
        "credentials",
        sa.Column("description", sa.Text(), nullable=True),
    )
    op.add_column(
        "credentials",
        sa.Column("name", sa.String(255), nullable=False, server_default=""),
    )
