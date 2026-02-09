"""Tests for password generator."""

import string

import pytest

from app.core.password_generator import generate_passphrase, generate_password


class TestGeneratePassword:
    """Tests for generate_password function."""

    def test_default_length(self):
        pw = generate_password()
        assert len(pw) == 20

    def test_custom_length(self):
        pw = generate_password(length=32)
        assert len(pw) == 32

    def test_min_length_enforced(self):
        pw = generate_password(length=3)
        assert len(pw) == 8  # Minimum enforced

    def test_max_length_enforced(self):
        pw = generate_password(length=200)
        assert len(pw) == 128  # Maximum enforced

    def test_contains_uppercase(self):
        pw = generate_password(uppercase=True, lowercase=False, digits=False, symbols=False)
        assert any(c in string.ascii_uppercase for c in pw)

    def test_contains_lowercase(self):
        pw = generate_password(uppercase=False, lowercase=True, digits=False, symbols=False)
        assert any(c in string.ascii_lowercase for c in pw)

    def test_contains_digits(self):
        pw = generate_password(uppercase=False, lowercase=False, digits=True, symbols=False)
        assert any(c in string.digits for c in pw)

    def test_contains_symbols(self):
        pw = generate_password(uppercase=False, lowercase=False, digits=False, symbols=True)
        assert any(c in "!@#$%^&*()-_=+[]{}|;:,.<>?" for c in pw)

    def test_all_character_types(self):
        pw = generate_password(length=20)
        assert any(c in string.ascii_uppercase for c in pw)
        assert any(c in string.ascii_lowercase for c in pw)
        assert any(c in string.digits for c in pw)
        assert any(c in "!@#$%^&*()-_=+[]{}|;:,.<>?" for c in pw)

    def test_exclude_ambiguous(self):
        # Generate many passwords to increase chance of finding excluded chars
        for _ in range(50):
            pw = generate_password(length=50, exclude_ambiguous=True)
            assert "O" not in pw
            assert "I" not in pw
            assert "l" not in pw
            assert "0" not in pw
            assert "1" not in pw

    def test_uniqueness(self):
        passwords = {generate_password() for _ in range(100)}
        assert len(passwords) == 100  # All should be unique

    def test_no_charset_fallback(self):
        pw = generate_password(
            uppercase=False, lowercase=False, digits=False, symbols=False
        )
        assert len(pw) >= 8


class TestGeneratePassphrase:
    """Tests for generate_passphrase function."""

    def test_default_word_count(self):
        phrase = generate_passphrase()
        words = phrase.split("-")
        assert len(words) == 5

    def test_custom_word_count(self):
        phrase = generate_passphrase(word_count=3)
        words = phrase.split("-")
        assert len(words) == 3

    def test_custom_separator(self):
        phrase = generate_passphrase(separator=".")
        assert "." in phrase

    def test_capitalize(self):
        phrase = generate_passphrase(capitalize=True)
        for word in phrase.split("-"):
            assert word[0].isupper()

    def test_include_number(self):
        phrase = generate_passphrase(include_number=True)
        assert any(c.isdigit() for c in phrase)

    def test_min_word_count(self):
        phrase = generate_passphrase(word_count=1)
        words = phrase.split("-")
        assert len(words) == 3  # Minimum enforced

    def test_uniqueness(self):
        phrases = {generate_passphrase() for _ in range(50)}
        assert len(phrases) >= 40  # Most should be unique
