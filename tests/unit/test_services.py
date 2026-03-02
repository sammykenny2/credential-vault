"""Tests for service layer."""

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User, UserRole
from app.schemas.credential import CredentialCreate
from app.schemas.user import UserCreate
from app.services.credential import CredentialService
from app.services.user import UserService


class TestUserService:
    """Test UserService functions."""

    @pytest.mark.asyncio
    async def test_create_user(self, db_session: AsyncSession, test_user_data):
        """Test creating a new user."""
        service = UserService(db_session)
        user_create = UserCreate(**test_user_data)

        user = await service.create(user_create)

        assert user.id is not None
        assert user.email == test_user_data["email"]
        assert user.display_name == test_user_data["display_name"]
        assert user.role == UserRole.USER
        assert user.is_active is True

    @pytest.mark.asyncio
    async def test_create_oauth_user(self, db_session: AsyncSession):
        """Test creating a user via OAuth."""
        service = UserService(db_session)

        user = await service.create_oauth_user(
            email="oauth@example.com",
            display_name="OAuth User",
            google_id="google-oauth-123",
        )

        assert user.id is not None
        assert user.email == "oauth@example.com"
        assert user.display_name == "OAuth User"
        assert user.google_id == "google-oauth-123"
        assert user.role == UserRole.USER

    @pytest.mark.asyncio
    async def test_get_user_by_email(self, db_session: AsyncSession, test_user_data):
        """Test fetching a user by email."""
        service = UserService(db_session)
        user_create = UserCreate(**test_user_data)
        created = await service.create(user_create)

        fetched = await service.get_by_email(test_user_data["email"])

        assert fetched is not None
        assert fetched.id == created.id

    @pytest.mark.asyncio
    async def test_get_user_by_id(self, db_session: AsyncSession, test_user_data):
        """Test fetching a user by ID."""
        service = UserService(db_session)
        user_create = UserCreate(**test_user_data)
        created = await service.create(user_create)

        fetched = await service.get_by_id(created.id)

        assert fetched is not None
        assert fetched.email == test_user_data["email"]

    @pytest.mark.asyncio
    async def test_get_by_google_id(self, db_session: AsyncSession):
        """Test fetching a user by Google ID."""
        service = UserService(db_session)

        user = await service.create_oauth_user(
            email="google@example.com",
            display_name="Google User",
            google_id="google-id-456",
        )

        fetched = await service.get_by_google_id("google-id-456")
        assert fetched is not None
        assert fetched.id == user.id

        # Non-existent google_id
        not_found = await service.get_by_google_id("nonexistent")
        assert not_found is None

    @pytest.mark.asyncio
    async def test_setup_vault_keys(self, db_session: AsyncSession):
        """Test setting up E2EE vault keys."""
        service = UserService(db_session)

        user = await service.create_oauth_user(
            email="vault@example.com",
            display_name="Vault User",
            google_id="google-vault-123",
        )
        assert user.has_vault_keys is False

        updated = await service.setup_vault_keys(
            user=user,
            public_key="test-public-key-base64",
            encrypted_private_key="test-encrypted-private-key-base64",
            key_salt="test-salt-base64",
        )

        assert updated.public_key == "test-public-key-base64"
        assert updated.encrypted_private_key == "test-encrypted-private-key-base64"
        assert updated.key_salt == "test-salt-base64"
        assert updated.has_vault_keys is True

    @pytest.mark.asyncio
    async def test_link_google_account(self, db_session: AsyncSession, test_user_data):
        """Test linking a Google account to an existing user."""
        service = UserService(db_session)
        user_create = UserCreate(**test_user_data)
        user = await service.create(user_create)

        updated = await service.link_google_account(user, "new-google-id-789")

        assert updated.google_id == "new-google-id-789"

    @pytest.mark.asyncio
    async def test_deactivate_user(self, db_session: AsyncSession, test_user_data):
        """Test deactivating a user."""
        service = UserService(db_session)
        user_create = UserCreate(**test_user_data)
        user = await service.create(user_create)

        await service.deactivate(user)

        assert user.is_active is False

    @pytest.mark.asyncio
    async def test_count_active_admins_none(self, db_session: AsyncSession):
        """Test counting admins when none exist."""
        service = UserService(db_session)
        count = await service.count_active_admins()
        assert count == 0

    @pytest.mark.asyncio
    async def test_count_active_admins(self, db_session: AsyncSession):
        """Test counting active admins."""
        service = UserService(db_session)

        # Create regular user
        await service.create_oauth_user(
            email="user1@test.com", display_name="User 1", google_id="g-user1"
        )

        # Create two admins
        await service.create_oauth_user(
            email="admin1@test.com",
            display_name="Admin 1",
            google_id="g-admin1",
            role=UserRole.ADMIN,
        )

        admin2 = await service.create_oauth_user(
            email="admin2@test.com",
            display_name="Admin 2",
            google_id="g-admin2",
            role=UserRole.ADMIN,
        )

        count = await service.count_active_admins()
        assert count == 2

        # Deactivate one admin
        await service.deactivate(admin2)
        count = await service.count_active_admins()
        assert count == 1

    @pytest.mark.asyncio
    async def test_is_last_admin(self, db_session: AsyncSession):
        """Test checking if user is the last admin."""
        service = UserService(db_session)

        # Create single admin
        admin1 = await service.create_oauth_user(
            email="admin1@test.com",
            display_name="Admin 1",
            google_id="g-admin1",
            role=UserRole.ADMIN,
        )

        assert await service.is_last_admin(admin1) is True

        # Create another admin
        await service.create_oauth_user(
            email="admin2@test.com",
            display_name="Admin 2",
            google_id="g-admin2",
            role=UserRole.ADMIN,
        )

        assert await service.is_last_admin(admin1) is False

    @pytest.mark.asyncio
    async def test_is_last_admin_non_admin(self, db_session: AsyncSession, test_user_data):
        """Test is_last_admin returns False for non-admin users."""
        service = UserService(db_session)
        user_create = UserCreate(**test_user_data)
        user = await service.create(user_create, role=UserRole.USER)

        assert await service.is_last_admin(user) is False

    @pytest.mark.asyncio
    async def test_delete_user_credentials(self, db_session: AsyncSession, test_user_data):
        """Test deleting all credentials for a user."""
        from app.models.credential import Credential

        service = UserService(db_session)
        user_create = UserCreate(**test_user_data)
        user = await service.create(user_create)

        # Create some credentials (no plaintext metadata)
        for i in range(3):
            cred = Credential(
                owner_id=user.id,
                encrypted_data=f"test_data_{i}",
            )
            db_session.add(cred)
        await db_session.flush()

        # Verify credentials exist
        count = await service.get_credential_count(user.id)
        assert count == 3

        # Delete credentials
        deleted_count = await service.delete_user_credentials(user.id)
        assert deleted_count == 3

        # Verify credentials are gone
        count = await service.get_credential_count(user.id)
        assert count == 0

    @pytest.mark.asyncio
    async def test_reactivate_user(self, db_session: AsyncSession, test_user_data):
        """Test reactivating a deactivated user."""
        service = UserService(db_session)
        user_create = UserCreate(**test_user_data)
        user = await service.create(user_create)

        # Deactivate
        await service.deactivate(user)
        assert user.is_active is False

        # Reactivate
        await service.reactivate(user)
        assert user.is_active is True

    @pytest.mark.asyncio
    async def test_hard_delete_user(self, db_session: AsyncSession, test_user_data):
        """Test hard deleting a user removes them completely."""
        from app.models.credential import Credential

        service = UserService(db_session)
        user_create = UserCreate(**test_user_data)
        user = await service.create(user_create)
        user_id = user.id

        # Add some credentials (no plaintext metadata)
        for i in range(2):
            cred = Credential(
                owner_id=user.id,
                encrypted_data=f"test_data_{i}",
            )
            db_session.add(cred)
        await db_session.flush()

        # Hard delete
        await service.hard_delete(user)

        # Verify user is gone
        deleted_user = await service.get_by_id(user_id)
        assert deleted_user is None

        # Verify credentials are gone
        count = await service.get_credential_count(user_id)
        assert count == 0


class TestCredentialService:
    """Test CredentialService functions."""

    @pytest_asyncio.fixture
    async def test_user(self, db_session: AsyncSession, test_user_data) -> User:
        """Create a test user for credential tests."""
        service = UserService(db_session)
        return await service.create_oauth_user(
            email=test_user_data["email"],
            display_name=test_user_data["display_name"],
            google_id=test_user_data["google_id"],
        )

    @pytest.mark.asyncio
    async def test_create_credential(
        self,
        db_session: AsyncSession,
        test_user: User,
        test_credential_data,
    ):
        """Test creating a new credential (encrypted blob only)."""
        service = CredentialService(db_session)

        credential_create = CredentialCreate(
            encrypted_data=test_credential_data["encrypted_data"],
        )

        credential = await service.create(test_user.id, credential_create)

        assert credential.id is not None
        assert credential.owner_id == test_user.id
        assert credential.is_active is True
        assert credential.encrypted_data == test_credential_data["encrypted_data"]

    @pytest.mark.asyncio
    async def test_get_credential_by_owner(
        self,
        db_session: AsyncSession,
        test_user: User,
        test_credential_data,
    ):
        """Test fetching a credential by owner."""
        service = CredentialService(db_session)

        credential_create = CredentialCreate(
            encrypted_data=test_credential_data["encrypted_data"],
        )

        created = await service.create(test_user.id, credential_create)
        fetched = await service.get_by_id(created.id, test_user.id)

        assert fetched is not None
        assert fetched.id == created.id

    @pytest.mark.asyncio
    async def test_get_credential_wrong_owner(
        self,
        db_session: AsyncSession,
        test_user: User,
        test_credential_data,
    ):
        """Test that credentials cannot be accessed by wrong owner."""
        service = CredentialService(db_session)

        credential_create = CredentialCreate(
            encrypted_data=test_credential_data["encrypted_data"],
        )

        created = await service.create(test_user.id, credential_create)
        fetched = await service.get_by_id(created.id, "different-user-id")

        assert fetched is None

    @pytest.mark.asyncio
    async def test_list_credentials(
        self,
        db_session: AsyncSession,
        test_user: User,
    ):
        """Test listing credentials."""
        service = CredentialService(db_session)

        # Create multiple credentials with opaque encrypted data
        for i in range(3):
            credential_create = CredentialCreate(
                encrypted_data=f"opaque-encrypted-blob-{i}",
            )
            await service.create(test_user.id, credential_create)

        credentials = await service.list_by_owner(test_user.id)

        assert len(credentials) == 3

    @pytest.mark.asyncio
    async def test_revoke_credential(
        self,
        db_session: AsyncSession,
        test_user: User,
        test_credential_data,
    ):
        """Test revoking a credential."""
        service = CredentialService(db_session)

        credential_create = CredentialCreate(
            encrypted_data=test_credential_data["encrypted_data"],
        )

        credential = await service.create(test_user.id, credential_create)
        revoked = await service.revoke(credential)

        assert revoked.is_active is False
        assert revoked.revoked_at is not None
