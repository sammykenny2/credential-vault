"""Add users.token_version for server-side token revocation.

Revision ID: 3f9c2d1e7b40
Revises: 2eb8a5da3d16
Create Date: 2026-10-23 09:00:00

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "3f9c2d1e7b40"
down_revision: str | None = "2eb8a5da3d16"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add the token_version counter; every issued JWT carries it as `ver`."""
    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("token_version", sa.Integer(), nullable=False, server_default="0")
        )


def downgrade() -> None:
    """Drop the token_version counter."""
    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.drop_column("token_version")
