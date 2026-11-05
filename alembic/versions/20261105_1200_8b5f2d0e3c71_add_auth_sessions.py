"""Durable refresh families and atomic first-admin claim.

Revision ID: 8b5f2d0e3c71
Revises: 7a4e1c9d2b60
"""

import sqlalchemy as sa

from alembic import op

revision = "8b5f2d0e3c71"
down_revision = "7a4e1c9d2b60"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "auth_sessions",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("refresh_hash", sa.String(64), nullable=False),
        sa.Column("expires_at", sa.BigInteger(), nullable=False),
        sa.Column("rotated_at", sa.BigInteger(), nullable=False),
        sa.Column("revoked_at", sa.BigInteger(), nullable=True),
    )
    op.create_index("ix_auth_sessions_user_id", "auth_sessions", ["user_id"])
    op.create_index("ix_auth_sessions_expires_at", "auth_sessions", ["expires_at"])
    op.create_table("admin_bootstrap_claim", sa.Column("id", sa.Integer(), primary_key=True))
    op.execute(
        sa.text(
            "INSERT INTO admin_bootstrap_claim (id) SELECT 1 WHERE EXISTS "
            "(SELECT 1 FROM users WHERE role = 'ADMIN')"
        )
    )


def downgrade() -> None:
    raise RuntimeError("Auth sessions cannot be downgraded safely; restore a pre-upgrade snapshot.")
