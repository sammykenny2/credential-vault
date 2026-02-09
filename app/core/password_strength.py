"""Password strength analysis.

Provides scoring and feedback for password quality assessment.
"""

import math
import re

# Common passwords (top 100 subset for quick check)
COMMON_PASSWORDS = frozenset(
    [
        "password",
        "123456",
        "12345678",
        "qwerty",
        "abc123",
        "monkey",
        "1234567",
        "letmein",
        "trustno1",
        "dragon",
        "baseball",
        "iloveyou",
        "master",
        "sunshine",
        "ashley",
        "michael",
        "shadow",
        "123123",
        "654321",
        "superman",
        "qazwsx",
        "password1",
        "password123",
        "admin",
        "welcome",
        "hello",
        "charlie",
        "donald",
        "login",
        "princess",
        "starwars",
        "passw0rd",
        "p@ssw0rd",
        "p@ssword",
        "football",
        "access",
        "flower",
        "hottie",
        "loveme",
        "zaq1zaq1",
        "00000000",
        "11111111",
        "12345",
        "123456789",
        "1234567890",
        "qwerty123",
        "1q2w3e4r",
        "1qaz2wsx",
        "abcdef",
        "abcdefgh",
    ]
)

# Keyboard patterns
KEYBOARD_ROWS = ["qwertyuiop", "asdfghjkl", "zxcvbnm", "1234567890"]
KEYBOARD_PATTERNS = KEYBOARD_ROWS + [row[::-1] for row in KEYBOARD_ROWS]


def analyze_password(password: str) -> dict:
    """Analyze password strength and return detailed results.

    Returns:
        Dictionary with:
        - score: 0-100 integer score
        - level: "very_weak" | "weak" | "fair" | "strong" | "very_strong"
        - feedback: List of improvement suggestions
        - details: Breakdown of scoring factors
    """
    if not password:
        return {
            "score": 0,
            "level": "very_weak",
            "feedback": ["Password is empty"],
            "details": {},
            "crack_time_display": "instant",
        }

    length = len(password)
    feedback = []
    details = {}

    # === Character set analysis ===
    has_lower = bool(re.search(r"[a-z]", password))
    has_upper = bool(re.search(r"[A-Z]", password))
    has_digit = bool(re.search(r"\d", password))
    has_symbol = bool(re.search(r"[^a-zA-Z0-9]", password))
    has_unicode = bool(re.search(r"[^\x00-\x7F]", password))

    charset_size = 0
    if has_lower:
        charset_size += 26
    if has_upper:
        charset_size += 26
    if has_digit:
        charset_size += 10
    if has_symbol:
        charset_size += 33
    if has_unicode:
        charset_size += 100

    details["charset_size"] = charset_size
    details["has_lowercase"] = has_lower
    details["has_uppercase"] = has_upper
    details["has_digits"] = has_digit
    details["has_symbols"] = has_symbol
    details["length"] = length

    # === Entropy calculation ===
    if charset_size > 0:
        entropy = length * math.log2(charset_size)
    else:
        entropy = 0
    details["entropy_bits"] = round(entropy, 1)

    # === Scoring ===
    score = 0.0

    # Length score (0-30)
    length_score = min(30, length * 2)
    score += length_score

    # Charset diversity (0-25)
    diversity = sum([has_lower, has_upper, has_digit, has_symbol])
    diversity_score = diversity * 6.25
    score += diversity_score

    # Entropy bonus (0-25)
    entropy_score = min(25, entropy / 4)
    score += entropy_score

    # === Penalties ===

    # Common password check
    if password.lower() in COMMON_PASSWORDS:
        score = min(score, 5)
        feedback.append("This is a commonly used password")

    # All same character
    if len(set(password)) == 1:
        score = min(score, 5)
        feedback.append("Password contains only one unique character")

    # Sequential characters
    sequential_count = 0
    for i in range(len(password) - 2):
        if ord(password[i]) + 1 == ord(password[i + 1]) == ord(password[i + 2]) - 1:
            sequential_count += 1
    if sequential_count > 0:
        penalty = sequential_count * 5
        score -= penalty
        feedback.append("Avoid sequential characters (abc, 123)")

    # Repeated patterns
    for pattern_len in range(1, len(password) // 2 + 1):
        pattern = password[:pattern_len]
        repeat_count = len(password) // pattern_len
        if pattern * repeat_count == password[: pattern_len * repeat_count]:
            if len(password) // pattern_len >= 3:
                score -= 15
                feedback.append("Avoid repeating patterns")
                break

    # Keyboard patterns
    lower_pw = password.lower()
    for pattern in KEYBOARD_PATTERNS:
        for i in range(len(pattern) - 3):
            if pattern[i : i + 4] in lower_pw:
                score -= 10
                feedback.append("Avoid keyboard patterns (qwerty, asdf)")
                break
        else:
            continue
        break

    # === Feedback generation ===
    if length < 8:
        feedback.append("Use at least 8 characters")
    elif length < 12:
        feedback.append("Consider using 12+ characters for better security")

    if not has_upper:
        feedback.append("Add uppercase letters")
    if not has_lower:
        feedback.append("Add lowercase letters")
    if not has_digit:
        feedback.append("Add numbers")
    if not has_symbol:
        feedback.append("Add special characters (!@#$%)")

    # Unique characters ratio
    unique_ratio = len(set(password)) / length if length > 0 else 0
    if unique_ratio < 0.5 and length > 4:
        score -= 10
        feedback.append("Use more unique characters")

    # === Final score normalization ===
    score = max(0, min(100, int(score)))

    # Bonus for very long passwords
    if length >= 20 and diversity >= 3:
        score = max(score, 80)
    if length >= 16 and diversity >= 4:
        score = max(score, 75)

    # === Level determination ===
    if score >= 80:
        level = "very_strong"
    elif score >= 60:
        level = "strong"
    elif score >= 40:
        level = "fair"
    elif score >= 20:
        level = "weak"
    else:
        level = "very_weak"

    # === Crack time estimation ===
    crack_time = _estimate_crack_time(entropy)

    return {
        "score": score,
        "level": level,
        "feedback": feedback[:5],  # Limit to top 5 suggestions
        "details": details,
        "crack_time_display": crack_time,
    }


def _estimate_crack_time(entropy_bits: float) -> str:
    """Estimate time to crack based on entropy, assuming 10B guesses/sec."""
    if entropy_bits <= 0:
        return "instant"

    guesses = 2**entropy_bits
    seconds = guesses / 10_000_000_000  # 10 billion guesses/sec

    if seconds < 1:
        return "instant"
    elif seconds < 60:
        return f"{int(seconds)} seconds"
    elif seconds < 3600:
        return f"{int(seconds / 60)} minutes"
    elif seconds < 86400:
        return f"{int(seconds / 3600)} hours"
    elif seconds < 86400 * 365:
        return f"{int(seconds / 86400)} days"
    elif seconds < 86400 * 365 * 1000:
        return f"{int(seconds / (86400 * 365))} years"
    elif seconds < 86400 * 365 * 1_000_000:
        return f"{int(seconds / (86400 * 365 * 1000))}K years"
    elif seconds < 86400 * 365 * 1_000_000_000:
        return f"{int(seconds / (86400 * 365 * 1_000_000))}M years"
    else:
        return "centuries"
