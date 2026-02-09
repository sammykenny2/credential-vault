"""Have I Been Pwned (HIBP) integration.

Uses the k-Anonymity API to check if passwords appear in known breaches
without sending the full password hash over the network.
"""

import hashlib
import logging

import httpx

logger = logging.getLogger(__name__)

HIBP_API_URL = "https://api.pwnedpasswords.com/range/"
HIBP_TIMEOUT = 5.0


async def check_password_breach(password: str) -> dict:
    """Check if a password has been seen in data breaches.

    Uses the HIBP k-Anonymity model:
    1. SHA-1 hash the password
    2. Send only the first 5 hex chars to the API
    3. Compare the rest locally

    Args:
        password: The plaintext password to check.

    Returns:
        Dictionary with:
        - breached: bool - whether the password was found
        - count: int - number of times seen in breaches (0 if not found)
        - error: str | None - error message if API call failed
    """
    sha1_hash = hashlib.sha1(password.encode("utf-8")).hexdigest().upper()
    prefix = sha1_hash[:5]
    suffix = sha1_hash[5:]

    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{HIBP_API_URL}{prefix}",
                timeout=HIBP_TIMEOUT,
                headers={"User-Agent": "CredentialVault-PasswordChecker"},
            )
            response.raise_for_status()

        for line in response.text.splitlines():
            hash_suffix, count = line.strip().split(":")
            if hash_suffix == suffix:
                return {
                    "breached": True,
                    "count": int(count),
                    "error": None,
                }

        return {
            "breached": False,
            "count": 0,
            "error": None,
        }

    except httpx.TimeoutException:
        logger.warning("HIBP API timeout")
        return {
            "breached": False,
            "count": 0,
            "error": "HIBP API timeout - could not verify",
        }
    except Exception as e:
        logger.error("HIBP API error: %s", str(e))
        return {
            "breached": False,
            "count": 0,
            "error": f"HIBP API error: {str(e)}",
        }
