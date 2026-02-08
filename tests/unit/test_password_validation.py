"""Tests for password strength validation."""

import pytest
from pydantic import ValidationError

from app.schemas.auth import PasswordChange
from app.schemas.user import UserCreate


class TestPasswordStrengthValidation:
    """Test password complexity requirements."""

    def test_valid_password(self):
        """Test that a valid password passes validation."""
        user = UserCreate(
            email="test@example.com",
            display_name="Test",
            password="StrongP@ss1",
        )
        assert user.password == "StrongP@ss1"

    def test_password_too_short(self):
        """Test that short passwords are rejected."""
        with pytest.raises(ValidationError, match="at least 8 characters"):
            UserCreate(
                email="test@example.com",
                display_name="Test",
                password="Ab1!",
            )

    def test_password_no_uppercase(self):
        """Test that passwords without uppercase are rejected."""
        with pytest.raises(ValidationError, match="uppercase"):
            UserCreate(
                email="test@example.com",
                display_name="Test",
                password="nouppercase1!",
            )

    def test_password_no_lowercase(self):
        """Test that passwords without lowercase are rejected."""
        with pytest.raises(ValidationError, match="lowercase"):
            UserCreate(
                email="test@example.com",
                display_name="Test",
                password="NOLOWERCASE1!",
            )

    def test_password_no_digit(self):
        """Test that passwords without digits are rejected."""
        with pytest.raises(ValidationError, match="digit"):
            UserCreate(
                email="test@example.com",
                display_name="Test",
                password="NoDigits!!Ab",
            )

    def test_password_no_special_char(self):
        """Test that passwords without special characters are rejected."""
        with pytest.raises(ValidationError, match="special character"):
            UserCreate(
                email="test@example.com",
                display_name="Test",
                password="NoSpecial123",
            )

    def test_password_change_validation(self):
        """Test that PasswordChange also validates new password."""
        with pytest.raises(ValidationError, match="uppercase"):
            PasswordChange(
                current_password="anything",
                new_password="nouppercase1!",
            )

    def test_password_change_valid(self):
        """Test that valid PasswordChange passes."""
        change = PasswordChange(
            current_password="old_password",
            new_password="NewP@ssw0rd!",
        )
        assert change.new_password == "NewP@ssw0rd!"
