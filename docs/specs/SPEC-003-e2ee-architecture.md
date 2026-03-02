# SPEC-003: Zero-Knowledge End-to-End Encryption (E2EE) Architecture

> Feature Specification

## Metadata

| Field | Value |
|-------|-------|
| **Status** | Implemented |
| **Owner** | Gemini (Architect) |
| **Reviewer** | User |

## Summary

This specification defines the complete overhaul of the Credential Vault's cryptographic architecture. It moves from Server-Side Encryption (SSE) where a global environment key (`ENCRYPTION_KEY`) decrypts all vault items, to a true Zero-Knowledge End-to-End Encryption (E2EE) model. It introduces Google OAuth for primary identity authentication, while using a user-memorized "Vault Password" to derive the cryptographic keys necessary for encrypting and decrypting credential data entirely within the client's browser.

## Goals

- **Zero-Knowledge Security:** Mathematical guarantee that the backend server, database administrators, and potential attackers cannot read stored credential data.
- **Identify Provider (IdP) Integration:** Support Google OAuth 2.0 to handle user authentication seamlessly.
- **Client-Side Cryptography:** Implement standardized, audited, and secure cryptographic operations (Argon2id, AES-GCM, RSA-OAEP) entirely within the frontend using Web Crypto API or `libsodium`.

## Non-Goals

- Replacing the entire backend framework. The backend will remain FastAPI, but will transition from performing crypto operations to acting as a secure "blind storage" API.
- Hardware-bound Passkeys (WebAuthn) for encryption (as requested by the user, we will stick to a Vault Password derived key).

## User Stories

- As a security-conscious user, I want my credential vault to be readable only by me, so that even if the host server is fully compromised, my passwords remain inaccessible to the attacker.
- As a user seeking convenience, I want to authenticate to the vault using my Google Account so I do not have to manage a separate identity credential, while still retaining cryptographic security over my data via my Vault Password.
- As an administrator, I want the backend to be simple and stateless concerning user secrets, reducing the liability of hosting the `ENCRYPTION_KEY` in plain text.

## Requirements

### Functional Requirements

1. **FR-1:** The backend API shall provide endpoints for Google OAuth 2.0 login and registration callbacks, returning a standard JWT access token for API authorization.
2. **FR-2:** The backend API shall provide endpoints for a client to store and retrieve their `public_key` and their `encrypted_private_key`.
3. **FR-3:** The backend `users` database table shall be migrated to store `public_key` (text), `encrypted_private_key` (text), and `key_salt` (string).
4. **FR-4:** The frontend shall implement Argon2id to derive a 256-bit Master Key from the user's Vault Password + `key_salt`.
5. **FR-5:** The frontend shall implement RSA-OAEP (or ECDH) key pair generation upon Vault Initialization.
6. **FR-6:** The frontend shall use AES-256-GCM (using the Master Key) to encrypt the generated Private Key before uploading it to the backend.
7. **FR-7:** The frontend shall encrypt all new/modified credential fields using AES-256-GCM (or hybrid RSA-AES) using the user's Public Key/Private Key before sending the payload to the backend.
8. **FR-8:** The backend `credentials` table shall accept arbitrary encrypted JSON blobs, dropping previous plaintext fields if any.

### Non-Functional Requirements

- **Performance**: Argon2id parameters (iterations, memory, parallelism) must be tuned to provide a balance between security (brute-force resistance) and UI responsiveness. The derivation should take ~500ms-1s on an average modern device.
- **Security**: The Master Key and plaintext Private Key must never be serialized to `localStorage` or `sessionStorage`. They must reside strictly in short-lived memory contexts (Web Workers or secure variables) and be discarded upon logout or timeout.
- **Compatibility**: The frontend cryptography must utilize the standard Web Crypto API supported by modern browsers.

## Design Overview

**Authentication & Vault Unlocking Flow:**

1. **User clicks "Sign In with Google".**
2. **Backend validates OAuth callback, creates/fetches user record, issues JWT Authorization token.**
3. **Frontend receives JWT.** Server also sends `public_key`, `key_salt`, and `encrypted_private_key`.
4. **Frontend prompts user:** "Enter Vault Password to unlock credentials."
5. **User enters Vault Password.**
6. **Frontend derives Master Key:** `Master_Key = Argon2id(Vault_Password, key_salt)`
7. **Frontend decrypts Private Key:** `Private_Key = AES-GCM-Decrypt(Master_Key, encrypted_private_key)`
8. **Master Key is purged from memory.**
9. **Frontend fetches Encrypted Credentials.**
10. **Frontend decrypts Credentials:** `Plaintext_Data = RSA-Decrypt(Private_Key, Encrypted_Data)` or via hybrid crypto.
11. **Vault renders in UI.**

## Dependencies

- **Backend:** `authlib` or `httpx` for handling Google OAuth protocols.
- **Frontend:** A robust, audited cryptography library for Argon2id (e.g., `argon2-browser` or `libsodium.js` WASM port) since `Argon2` is not natively supported by the Web Crypto API.

## Open Questions (Resolved)

- [x] **Hybrid encryption**: Yes — each credential gets a random AES-256 key, data is encrypted with AES-256-GCM, and the AES key is wrapped with RSA-OAEP. This handles arbitrary-length credential data.
- [x] **Migration strategy**: Wipe existing data and start fresh. No migration script for SSE→E2EE.
- [x] **Key derivation**: PBKDF2 (600K iterations, SHA-256) used instead of Argon2id for native Web Crypto API compatibility. Argon2id upgrade deferred to future.
- [x] **Metadata visibility**: `name`, `description`, `website_url`, `category` remain plaintext for server-side search. Only `encrypted_data` is E2EE.
- [x] **Removed features**: Sharing, Emergency Access, Backup, TOTP MFA permanently removed (incompatible with E2EE or redundant with Google OAuth 2FA).

## References

- [ADR-001: Adopt Zero-Knowledge End-to-End Encryption (E2EE) Architecture](../decisions/001-e2ee-architecture.md)
- W3C Web Cryptography API Specification

---

*Created: 2026-03-03*
*Author: Gemini (Architect)*
*Related Plan: [PLAN-003](../plans/PLAN-003-e2ee-architecture.md)*
