# ADR-001: Adopt Zero-Knowledge End-to-End Encryption (E2EE) Architecture

> Architecture Decision Record

## Status

Implemented (2026-03-03)

## Context

The current iteration of the Credential Vault relies on Server-Side Encryption (SSE) where a global `ENCRYPTION_KEY` is stored in the `.env` file on the backend server. The backend intercepts the user's login, queries the database, decrypts the credentials in memory using the global key, and returns the plaintext to the frontend.

This architecture has a critical centralized point of failure: any entity (e.g., a rogue system administrator, an AI agent, or an attacker) that gains read access to the server's `.env` file and the database can instantly decrypt every user's entire credential vault. Furthermore, the user wishes to delegate authentication to a trusted Identity Provider (IdP) such as Google OAuth for convenience, but OAuth tokens do not provide cryptographic material suitable for data encryption.

## Decision

We will transition the Credential Vault to a **Zero-Knowledge End-to-End Encryption (E2EE)** architecture. 

The new architecture will decouple **Authentication** from **Encryption**:
1. **Authentication (Identity):** Handled via Google OAuth (or standard JWT) to prove the user's identity.
2. **Encryption (Confidentiality):** Handled entirely in the client's browser (Frontend) using Web Crypto API.

**Key Mechanics:**
- The user will have a **Vault Password** known only to them.
- During registration/setup, the frontend will use Argon2id to derive a **Master Key** from the Vault Password.
- The frontend will generate an RSA-OAEP Key Pair (**Public/Private Key**).
- The Private Key is encrypted using the Master Key, and then the Master Key is discarded from memory.
- The server stores the Public Key and the *Encrypted* Private Key. The server never sees the Vault Password or the Master Key.
- For all subsequent operations, the frontend fetches the Encrypted Private Key, prompts the user for the Vault Password to derive the Master Key, decrypts the Private Key, and uses it to decrypt vault items fetched from the server.
- All credential vault items are encrypted by the frontend using the Public Key before being sent to the server.

## Consequences

### Positive

- **Zero-Knowledge Security:** The server (and its administrators) mathematically cannot decrypt the user's data, eliminating the `.env` single point of failure.
- **Convenience & Security:** Users can utilize Google OAuth (and its associated hardware MFA/Passkeys) for robust identity verification without compromising cryptographic confidentiality.
- **No Device Lock-in:** Because the encrypted private key is stored on the server, the user can log in from any new device as long as they authenticate via Google and remember their Vault Password.

### Negative

- **Irrecoverable Data Loss:** If a user loses their Vault Password, their data is permanently lost. There is no administrative "password reset" that can recover the data.
- **Frontend Complexity:** Significant cryptographic operations (Argon2id, RSA generation, AES-GCM encryption/decryption) must be implemented reliably in JavaScript/TypeScript using the Web Crypto API.
- **Performance Overhead:** Key derivation (Argon2id) is intentionally slow. It will add a ~500ms-1s delay during vault unlocking on the client side.

### Neutral

- **Database Schema Changes:** Requires additions to the `users` table (`public_key`, `encrypted_private_key`, `key_salt`) and modifications to how credential blobs are stored.

## Alternatives Considered

### Alternative 1: Device-Bound WebAuthn Keys (Passkeys)

- **Pros**: Phishing-resistant, extremely secure, relies on TPM/Secure Enclave.
- **Cons**: High friction for multi-device sync. If a user loses their hardware key or phone without setting up recovery, data is lost.
- **Why rejected**: User explicitly preferred avoiding strict device binding while maintaining security.

### Alternative 2: Keep Global Server-Side `ENCRYPTION_KEY`

- **Pros**: Very easy to implement. Allows for administrative password resets.
- **Cons**: Fundamentally insecure against server compromise. Does not meet the strict security requirements of the user.
- **Why rejected**: Violates the core objective of a privacy-first, zero-knowledge vault.

## References

- User Discussion: Shift from SSE to E2EE and Google OAuth Integration
- Web Crypto API Documentation
- Argon2id Password Hashing Standard

---

*Decision made: 2026-03-03*
*Decision makers: User, Gemini (Architect/Specialist)*
