"""E2EE migration: add OAuth/E2EE columns, drop removed feature tables.

Revision ID: 003_e2ee_migration
Revises: 002_add_new_features
Create Date: 2026-03-03

Changes:
- Add google_id, public_key, encrypted_private_key, key_salt to users
- Make hashed_password nullable (OAuth-only users)
- Remove mfa_enabled, mfa_secret from users
- Drop credential_shares table
- Drop emergency_access table
- Drop totp_accounts table
- Recreate audit_logs action enum (remove MFA/sharing/emergency/backup actions, add OAuth)
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "003_e2ee_migration"
down_revision: str | None = "002_add_new_features"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade database schema for E2EE."""
    # === Users table: Add new columns ===
    op.add_column("users", sa.Column("google_id", sa.String(255), nullable=True))
    op.add_column("users", sa.Column("public_key", sa.Text(), nullable=True))
    op.add_column("users", sa.Column("encrypted_private_key", sa.Text(), nullable=True))
    op.add_column("users", sa.Column("key_salt", sa.String(255), nullable=True))

    op.create_index(op.f("ix_users_google_id"), "users", ["google_id"], unique=True)

    # Make hashed_password nullable (OAuth-only users won't have one)
    op.alter_column("users", "hashed_password", nullable=True)

    # Remove MFA columns
    op.drop_column("users", "mfa_enabled")
    op.drop_column("users", "mfa_secret")

    # === Drop removed feature tables ===
    # Drop totp_accounts
    op.drop_index(op.f("ix_totp_accounts_user_id"), table_name="totp_accounts")
    op.drop_table("totp_accounts")

    # Drop credential_shares
    op.drop_index(op.f("ix_credential_shares_shared_with_id"), table_name="credential_shares")
    op.drop_index(op.f("ix_credential_shares_credential_id"), table_name="credential_shares")
    op.drop_table("credential_shares")

    # Drop emergency_access
    op.drop_index(op.f("ix_emergency_access_grantor_id"), table_name="emergency_access")
    op.drop_index(op.f("ix_emergency_access_grantee_id"), table_name="emergency_access")
    op.drop_table("emergency_access")

    # === Update audit_logs action enum ===
    # Add new enum values for the updated AuditAction
    # Note: PostgreSQL enums can only ADD values, not remove them.
    # Old values will remain in the DB enum but won't be used by the app.
    op.execute("ALTER TYPE auditaction ADD VALUE IF NOT EXISTS 'oauth_login'")
    op.execute("ALTER TYPE auditaction ADD VALUE IF NOT EXISTS 'vault_setup'")
    op.execute("ALTER TYPE auditaction ADD VALUE IF NOT EXISTS 'vault_unlock'")

    # Drop unused enum types from removed feature tables
    op.execute("DROP TYPE IF EXISTS emergencystatus")
    op.execute("DROP TYPE IF EXISTS sharepermission")


def downgrade() -> None:
    """Downgrade: restore removed tables and columns.

    WARNING: This is a destructive migration. Data from dropped tables cannot be recovered.
    """
    # Recreate emergency_access table
    op.create_table(
        "emergency_access",
        sa.Column("id", sa.UUID(as_uuid=False), nullable=False),
        sa.Column("grantor_id", sa.UUID(as_uuid=False), nullable=False),
        sa.Column("grantee_id", sa.UUID(as_uuid=False), nullable=False),
        sa.Column(
            "status",
            sa.Enum(
                "INVITED", "ACCEPTED", "RECOVERY_INITIATED",
                "RECOVERY_APPROVED", "RECOVERY_REJECTED", "REVOKED",
                name="emergencystatus",
            ),
            nullable=False,
        ),
        sa.Column("wait_time_days", sa.Integer(), nullable=False),
        sa.Column("recovery_initiated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("recovery_deadline", sa.DateTime(timezone=True), nullable=True),
        sa.Column("encrypted_key", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["grantee_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["grantor_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_emergency_access_grantee_id", "emergency_access", ["grantee_id"])
    op.create_index("ix_emergency_access_grantor_id", "emergency_access", ["grantor_id"])

    # Recreate credential_shares table
    op.create_table(
        "credential_shares",
        sa.Column("id", sa.UUID(as_uuid=False), nullable=False),
        sa.Column("credential_id", sa.UUID(as_uuid=False), nullable=False),
        sa.Column("shared_by_id", sa.UUID(as_uuid=False), nullable=False),
        sa.Column("shared_with_id", sa.UUID(as_uuid=False), nullable=False),
        sa.Column("encrypted_data", sa.Text(), nullable=False),
        sa.Column("permission", sa.Enum("READ_ONLY", "READ_WRITE", name="sharepermission"), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("accepted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["credential_id"], ["credentials.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["shared_by_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["shared_with_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_credential_shares_credential_id", "credential_shares", ["credential_id"])
    op.create_index("ix_credential_shares_shared_with_id", "credential_shares", ["shared_with_id"])

    # Recreate totp_accounts table
    op.create_table(
        "totp_accounts",
        sa.Column("id", sa.UUID(as_uuid=False), nullable=False),
        sa.Column("user_id", sa.UUID(as_uuid=False), nullable=False),
        sa.Column("encrypted_secret", sa.Text(), nullable=False),
        sa.Column("issuer", sa.String(255), nullable=False),
        sa.Column("account_name", sa.String(255), nullable=False),
        sa.Column("algorithm", sa.String(10), nullable=False),
        sa.Column("digits", sa.Integer(), nullable=False),
        sa.Column("period", sa.Integer(), nullable=False),
        sa.Column("credential_id", sa.UUID(as_uuid=False), nullable=True),
        sa.Column("icon", sa.String(50), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["credential_id"], ["credentials.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_totp_accounts_user_id", "totp_accounts", ["user_id"])

    # Restore MFA columns
    op.add_column("users", sa.Column("mfa_enabled", sa.Boolean(), nullable=False, server_default="false"))
    op.add_column("users", sa.Column("mfa_secret", sa.Text(), nullable=True))

    # Make hashed_password NOT NULL again
    op.alter_column("users", "hashed_password", nullable=False)

    # Drop new columns
    op.drop_index(op.f("ix_users_google_id"), table_name="users")
    op.drop_column("users", "key_salt")
    op.drop_column("users", "encrypted_private_key")
    op.drop_column("users", "public_key")
    op.drop_column("users", "google_id")
