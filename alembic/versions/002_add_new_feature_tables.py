"""Add credential sharing, emergency access, WebAuthn, TOTP, and expires_at.

Revision ID: 002_add_new_features
Revises: 001_add_templates
Create Date: 2026-02-09

"""

from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "002_add_new_features"
down_revision: Union[str, None] = "001_add_templates"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add new feature tables and columns."""
    # Add expires_at column to credentials table
    op.add_column(
        "credentials",
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_credentials_expires_at", "credentials", ["expires_at"])

    # Create credential_shares table
    op.create_table(
        "credential_shares",
        sa.Column("id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("credential_id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("shared_by_id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("shared_with_id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("encrypted_data", sa.Text(), nullable=False),
        sa.Column(
            "permission",
            sa.Enum("read_only", "read_write", name="sharepermission"),
            nullable=False,
            server_default="read_only",
        ),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("accepted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(
            ["credential_id"],
            ["credentials.id"],
            name="fk_credential_shares_credential_id",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["shared_by_id"],
            ["users.id"],
            name="fk_credential_shares_shared_by_id",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["shared_with_id"],
            ["users.id"],
            name="fk_credential_shares_shared_with_id",
            ondelete="CASCADE",
        ),
    )
    op.create_index(
        "ix_credential_shares_credential_id",
        "credential_shares",
        ["credential_id"],
    )
    op.create_index(
        "ix_credential_shares_shared_with_id",
        "credential_shares",
        ["shared_with_id"],
    )

    # Create emergency_access table
    op.create_table(
        "emergency_access",
        sa.Column("id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("grantor_id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("grantee_id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column(
            "status",
            sa.Enum(
                "invited",
                "accepted",
                "recovery_initiated",
                "recovery_approved",
                "recovery_rejected",
                "revoked",
                name="emergencystatus",
            ),
            nullable=False,
            server_default="invited",
        ),
        sa.Column("wait_time_days", sa.Integer(), nullable=False, server_default="7"),
        sa.Column(
            "recovery_initiated_at", sa.DateTime(timezone=True), nullable=True
        ),
        sa.Column("recovery_deadline", sa.DateTime(timezone=True), nullable=True),
        sa.Column("encrypted_key", sa.Text(), nullable=True),
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
            ["grantor_id"],
            ["users.id"],
            name="fk_emergency_access_grantor_id",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["grantee_id"],
            ["users.id"],
            name="fk_emergency_access_grantee_id",
            ondelete="CASCADE",
        ),
    )
    op.create_index(
        "ix_emergency_access_grantor_id", "emergency_access", ["grantor_id"]
    )
    op.create_index(
        "ix_emergency_access_grantee_id", "emergency_access", ["grantee_id"]
    )

    # Create webauthn_credentials table
    op.create_table(
        "webauthn_credentials",
        sa.Column("id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("credential_id", sa.LargeBinary(), nullable=False, unique=True),
        sa.Column("public_key", sa.LargeBinary(), nullable=False),
        sa.Column("sign_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "device_name",
            sa.String(255),
            nullable=False,
            server_default="Security Key",
        ),
        sa.Column("aaguid", sa.String(36), nullable=True),
        sa.Column(
            "credential_type",
            sa.String(50),
            nullable=False,
            server_default="public-key",
        ),
        sa.Column("transports", sa.String(255), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name="fk_webauthn_credentials_user_id",
            ondelete="CASCADE",
        ),
    )
    op.create_index(
        "ix_webauthn_credentials_user_id", "webauthn_credentials", ["user_id"]
    )

    # Create totp_accounts table
    op.create_table(
        "totp_accounts",
        sa.Column("id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("encrypted_secret", sa.Text(), nullable=False),
        sa.Column("issuer", sa.String(255), nullable=False),
        sa.Column("account_name", sa.String(255), nullable=False),
        sa.Column(
            "algorithm", sa.String(10), nullable=False, server_default="SHA1"
        ),
        sa.Column("digits", sa.Integer(), nullable=False, server_default="6"),
        sa.Column("period", sa.Integer(), nullable=False, server_default="30"),
        sa.Column(
            "credential_id",
            postgresql.UUID(as_uuid=False),
            nullable=True,
        ),
        sa.Column("icon", sa.String(50), nullable=True),
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
            ["user_id"],
            ["users.id"],
            name="fk_totp_accounts_user_id",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["credential_id"],
            ["credentials.id"],
            name="fk_totp_accounts_credential_id",
            ondelete="SET NULL",
        ),
    )
    op.create_index("ix_totp_accounts_user_id", "totp_accounts", ["user_id"])


def downgrade() -> None:
    """Remove new feature tables and columns."""
    # Drop tables in reverse order of creation
    op.drop_index("ix_totp_accounts_user_id", table_name="totp_accounts")
    op.drop_table("totp_accounts")

    op.drop_index("ix_webauthn_credentials_user_id", table_name="webauthn_credentials")
    op.drop_table("webauthn_credentials")

    op.drop_index("ix_emergency_access_grantee_id", table_name="emergency_access")
    op.drop_index("ix_emergency_access_grantor_id", table_name="emergency_access")
    op.drop_table("emergency_access")

    op.drop_index(
        "ix_credential_shares_shared_with_id", table_name="credential_shares"
    )
    op.drop_index(
        "ix_credential_shares_credential_id", table_name="credential_shares"
    )
    op.drop_table("credential_shares")

    # Drop enum types
    sa.Enum(name="emergencystatus").drop(op.get_bind(), checkfirst=True)
    sa.Enum(name="sharepermission").drop(op.get_bind(), checkfirst=True)

    # Remove expires_at column
    op.drop_index("ix_credentials_expires_at", table_name="credentials")
    op.drop_column("credentials", "expires_at")
