"""Tests for service layer."""

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.crypto import CredentialCrypto
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
        assert user.mfa_enabled is False

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
    async def test_authenticate_success(self, db_session: AsyncSession, test_user_data):
        """Test successful authentication."""
        service = UserService(db_session)
        user_create = UserCreate(**test_user_data)
        await service.create(user_create)

        authenticated = await service.authenticate(
            test_user_data["email"],
            test_user_data["password"],
        )

        assert authenticated is not None
        assert authenticated.email == test_user_data["email"]

    @pytest.mark.asyncio
    async def test_authenticate_wrong_password(self, db_session: AsyncSession, test_user_data):
        """Test authentication with wrong password."""
        service = UserService(db_session)
        user_create = UserCreate(**test_user_data)
        await service.create(user_create)

        authenticated = await service.authenticate(
            test_user_data["email"],
            "wrongpassword",
        )

        assert authenticated is None

    @pytest.mark.asyncio
    async def test_authenticate_nonexistent_user(self, db_session: AsyncSession):
        """Test authentication with non-existent user."""
        service = UserService(db_session)

        authenticated = await service.authenticate(
            "nonexistent@example.com",
            "anypassword",
        )

        assert authenticated is None

    @pytest.mark.asyncio
    async def test_deactivate_user(self, db_session: AsyncSession, test_user_data):
        """Test deactivating a user."""
        service = UserService(db_session)
        user_create = UserCreate(**test_user_data)
        user = await service.create(user_create)

        await service.deactivate(user)

        assert user.is_active is False

    @pytest.mark.asyncio
    async def test_authenticate_inactive_user(self, db_session: AsyncSession, test_user_data):
        """Test that inactive users cannot authenticate."""
        service = UserService(db_session)
        user_create = UserCreate(**test_user_data)
        user = await service.create(user_create)
        await service.deactivate(user)

        authenticated = await service.authenticate(
            test_user_data["email"],
            test_user_data["password"],
        )

        assert authenticated is None

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
        user1 = UserCreate(email="user1@test.com", password="P@ssw0rd!23", display_name="User 1")
        await service.create(user1, role=UserRole.USER)

        # Create two admins
        admin1 = UserCreate(email="admin1@test.com", password="P@ssw0rd!23", display_name="Admin 1")
        await service.create(admin1, role=UserRole.ADMIN)

        admin2 = UserCreate(email="admin2@test.com", password="P@ssw0rd!23", display_name="Admin 2")
        admin2_user = await service.create(admin2, role=UserRole.ADMIN)

        count = await service.count_active_admins()
        assert count == 2

        # Deactivate one admin
        await service.deactivate(admin2_user)
        count = await service.count_active_admins()
        assert count == 1

    @pytest.mark.asyncio
    async def test_is_last_admin(self, db_session: AsyncSession):
        """Test checking if user is the last admin."""
        service = UserService(db_session)

        # Create single admin
        admin1 = UserCreate(email="admin1@test.com", password="P@ssw0rd!23", display_name="Admin 1")
        admin1_user = await service.create(admin1, role=UserRole.ADMIN)

        assert await service.is_last_admin(admin1_user) is True

        # Create another admin
        admin2 = UserCreate(email="admin2@test.com", password="P@ssw0rd!23", display_name="Admin 2")
        await service.create(admin2, role=UserRole.ADMIN)

        assert await service.is_last_admin(admin1_user) is False

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

        # Create some credentials
        for i in range(3):
            cred = Credential(
                owner_id=user.id,
                name=f"Test Cred {i}",
                encrypted_data="test_data",
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

        # Add some credentials
        for i in range(2):
            cred = Credential(
                owner_id=user.id,
                name=f"Test Cred {i}",
                encrypted_data="test_data",
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
        user_create = UserCreate(**test_user_data)
        return await service.create(user_create)

    @pytest.mark.asyncio
    async def test_create_credential(
        self,
        db_session: AsyncSession,
        test_user: User,
        test_credential_data,
    ):
        """Test creating a new credential."""
        service = CredentialService(db_session)

        encrypted_data = CredentialCrypto.encrypt_credential(
            fields=test_credential_data["fields"],
            notes=test_credential_data["notes"],
        )

        credential_create = CredentialCreate(
            name=test_credential_data["name"],
            description=test_credential_data["description"],
            website_url=test_credential_data["website_url"],
            category=test_credential_data["category"],
            encrypted_data=encrypted_data,
        )

        credential = await service.create(test_user.id, credential_create)

        assert credential.id is not None
        assert credential.owner_id == test_user.id
        assert credential.name == test_credential_data["name"]
        assert credential.is_active is True

    @pytest.mark.asyncio
    async def test_get_credential_by_owner(
        self,
        db_session: AsyncSession,
        test_user: User,
        test_credential_data,
    ):
        """Test fetching a credential by owner."""
        service = CredentialService(db_session)

        encrypted_data = CredentialCrypto.encrypt_credential(
            fields=test_credential_data["fields"],
        )

        credential_create = CredentialCreate(
            name=test_credential_data["name"],
            encrypted_data=encrypted_data,
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

        encrypted_data = CredentialCrypto.encrypt_credential(
            fields={"Username": "test", "Password": "test"},
        )

        credential_create = CredentialCreate(
            name=test_credential_data["name"],
            encrypted_data=encrypted_data,
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

        # Create multiple credentials
        for i in range(3):
            encrypted_data = CredentialCrypto.encrypt_credential(
                fields={"Username": f"user{i}", "Password": f"pass{i}"},
            )
            credential_create = CredentialCreate(
                name=f"Credential {i}",
                encrypted_data=encrypted_data,
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

        encrypted_data = CredentialCrypto.encrypt_credential(
            fields={"Username": "test", "Password": "test"},
        )

        credential_create = CredentialCreate(
            name=test_credential_data["name"],
            encrypted_data=encrypted_data,
        )

        credential = await service.create(test_user.id, credential_create)
        revoked = await service.revoke(credential)

        assert revoked.is_active is False
        assert revoked.revoked_at is not None

    @pytest.mark.asyncio
    async def test_search_credentials(
        self,
        db_session: AsyncSession,
        test_user: User,
    ):
        """Test searching credentials."""
        service = CredentialService(db_session)

        # Create credentials with different names
        for name in ["GitHub Account", "GitLab Account", "Email Account"]:
            encrypted_data = CredentialCrypto.encrypt_credential(
                fields={"Username": "test", "Password": "test"},
            )
            credential_create = CredentialCreate(
                name=name,
                encrypted_data=encrypted_data,
            )
            await service.create(test_user.id, credential_create)

        # Search for "Git"
        results = await service.search(test_user.id, "Git")

        assert len(results) == 2
        assert all("Git" in c.name for c in results)

    @pytest.mark.asyncio
    async def test_decrypt_credential_data(
        self,
        db_session: AsyncSession,
        test_user: User,
        test_credential_data,
    ):
        """Test that credential data can be decrypted."""
        service = CredentialService(db_session)

        encrypted_data = CredentialCrypto.encrypt_credential(
            fields=test_credential_data["fields"],
            notes=test_credential_data["notes"],
        )

        credential_create = CredentialCreate(
            name=test_credential_data["name"],
            encrypted_data=encrypted_data,
        )

        credential = await service.create(test_user.id, credential_create)

        # Decrypt the stored data
        decrypted = CredentialCrypto.decrypt_credential(credential.encrypted_data)

        assert decrypted["fields"]["Username"] == test_credential_data["fields"]["Username"]
        assert decrypted["fields"]["Password"] == test_credential_data["fields"]["Password"]
        assert decrypted["notes"] == test_credential_data["notes"]
