"""Tests for service layer."""

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.crypto import CredentialCrypto
from src.models.user import User, UserRole
from src.schemas.credential import CredentialCreate
from src.schemas.user import UserCreate
from src.services.credential import CredentialService
from src.services.user import UserService


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
            username=test_credential_data["username"],
            password=test_credential_data["password"],
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
            username=test_credential_data["username"],
            password=test_credential_data["password"],
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
            username="test",
            password="test",
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
                username=f"user{i}",
                password=f"pass{i}",
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
            username="test",
            password="test",
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
                username="test",
                password="test",
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
            username=test_credential_data["username"],
            password=test_credential_data["password"],
            notes=test_credential_data["notes"],
        )

        credential_create = CredentialCreate(
            name=test_credential_data["name"],
            encrypted_data=encrypted_data,
        )

        credential = await service.create(test_user.id, credential_create)

        # Decrypt the stored data
        decrypted = CredentialCrypto.decrypt_credential(credential.encrypted_data)

        assert decrypted["username"] == test_credential_data["username"]
        assert decrypted["password"] == test_credential_data["password"]
        assert decrypted["notes"] == test_credential_data["notes"]
