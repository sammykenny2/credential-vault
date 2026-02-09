"""Tests for password strength analyzer."""

import pytest

from app.core.password_strength import analyze_password


class TestPasswordStrength:
    """Tests for analyze_password function."""

    def test_empty_password(self):
        result = analyze_password("")
        assert result["score"] == 0
        assert result["level"] == "very_weak"

    def test_common_password(self):
        result = analyze_password("password")
        assert result["score"] <= 10
        assert result["level"] == "very_weak"

    def test_short_password(self):
        result = analyze_password("Ab1!")
        assert result["score"] < 40
        assert "at least 8 characters" in str(result["feedback"])

    def test_weak_no_uppercase(self):
        result = analyze_password("abcdefgh123!")
        assert "Add uppercase letters" in result["feedback"]

    def test_weak_no_digits(self):
        result = analyze_password("Abcdefghij!")
        assert "Add numbers" in result["feedback"]

    def test_weak_no_symbols(self):
        result = analyze_password("Abcdefgh123")
        assert any("special characters" in f for f in result["feedback"])

    def test_strong_password(self):
        result = analyze_password("Tr0ub4dor&3Xtr@Long!")
        assert result["score"] >= 60
        assert result["level"] in ("strong", "very_strong")

    def test_very_strong_password(self):
        result = analyze_password("C0mpl3x!P@ssw0rd#W1th$M@ny&Ch@rs")
        assert result["score"] >= 75
        assert result["level"] in ("strong", "very_strong")

    def test_sequential_penalty(self):
        result = analyze_password("abcdefgh")
        assert any("sequential" in f.lower() for f in result["feedback"])

    def test_repeated_characters(self):
        result = analyze_password("aaaaaaaaaa")
        assert result["score"] < 20

    def test_keyboard_pattern(self):
        result = analyze_password("qwertyuiop")
        assert any("keyboard" in f.lower() for f in result["feedback"])

    def test_score_range(self):
        passwords = ["a", "password", "Test1234!", "C0mpl3x!P@ssW0rd#2024"]
        for pw in passwords:
            result = analyze_password(pw)
            assert 0 <= result["score"] <= 100

    def test_level_values(self):
        result = analyze_password("test")
        assert result["level"] in ("very_weak", "weak", "fair", "strong", "very_strong")

    def test_details_present(self):
        result = analyze_password("TestPassword123!")
        assert "entropy_bits" in result["details"]
        assert "charset_size" in result["details"]
        assert "length" in result["details"]

    def test_crack_time_present(self):
        result = analyze_password("TestPassword123!")
        assert "crack_time_display" in result
        assert isinstance(result["crack_time_display"], str)

    def test_feedback_limited(self):
        result = analyze_password("a")
        assert len(result["feedback"]) <= 5

    def test_long_diverse_password_bonus(self):
        result = analyze_password("A1b2C3d4E5f6G7h8I9j0!")
        assert result["score"] >= 75
