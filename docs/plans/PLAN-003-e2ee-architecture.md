# PLAN-003: Zero-Knowledge End-to-End Encryption (E2EE) Architecture

> Implementation Plan

## Metadata

| Field | Value |
|-------|-------|
| **Status** | Implemented |
| **Owner** | Gemini (Conductor) |
| **Assigned To** | Claude (Specialist) |
| **Reviewer** | User |
| **Implemented** | 2026-03-03 |

## Related Spec

[SPEC-003: Zero-Knowledge End-to-End Encryption (E2EE) Architecture](../specs/SPEC-003-e2ee-architecture.md)

## Related Decision

[ADR-001: Adopt Zero-Knowledge E2EE Architecture](../decisions/001-e2ee-architecture.md)

## Overview

This plan migrated the credential vault from Server-Side Encryption (SSE) with a global `ENCRYPTION_KEY` to a Zero-Knowledge E2EE architecture with Google OAuth for identity and client-side RSA-OAEP + AES-256-GCM hybrid encryption.

## Key Decisions (resolved during review)

1. **Auth**: Google OAuth only — email+password login fully removed
2. **Metadata**: `name`, `description`, `website_url`, `category` remain plaintext; only `encrypted_data` is E2EE
3. **Removed features**: Sharing, Emergency Access, Backup, MFA (TOTP) permanently removed
4. **Data migration**: Wipe DB and start fresh (no migration script)
5. **Encryption**: Hybrid encryption mandatory (per-credential AES-256-GCM key wrapped with RSA-OAEP)
6. **Key derivation**: PBKDF2 (600K iterations) for KEK derivation (Argon2id deferred to future optimization)

## Implementation Phases

### Phase 1: Database & Backend Preparation

- [x] Task 1.1: Alembic migration adding `public_key`, `encrypted_private_key`, `key_salt`, `google_id` to users; making `hashed_password` nullable; dropping `mfa_enabled`, `mfa_secret`
- [x] Task 1.2: Verified `encrypted_data` column already exists as TEXT — no schema change needed
- [x] Task 1.3: Updated SQLAlchemy models with new columns and `has_vault_keys` property
- [x] Task 1.4: Migration drops `credential_shares`, `emergency_access`, `totp_accounts` tables

### Phase 2: Refactoring Backend API & Identity

- [x] Task 2.1: Deleted `app/core/crypto.py` (SSE encryption module)
- [x] Task 2.2: Implemented Google OAuth 2.0 in `app/api/v1/oauth.py` using httpx
- [x] Task 2.3: Removed password-based login; JWT issued from OAuth callback
- [x] Task 2.4: Added `/auth/vault/setup` endpoint accepting E2EE key material
- [x] Task 2.5: Credential CRUD treats `encrypted_data` as opaque blob
- [x] Task 2.6: Removed sharing, emergency, backup, MFA, TOTP modules
- [x] Task 2.7: Removed `ENCRYPTION_KEY` from config/settings
- [x] Task 2.8: Updated bootstrap to OAuth-based admin auto-promotion

### Phase 3: Frontend Cryptography & Integration

- [x] Task 3.1: Google OAuth login button on LoginPage
- [x] Task 3.2: Rewrote `frontend/src/lib/crypto.ts` with PBKDF2 + RSA-OAEP + AES-256-GCM hybrid
- [x] Task 3.3: Vault Setup flow generates RSA keypair, encrypts private key, sends to server
- [x] Task 3.4: Vault Unlock flow derives KEK, decrypts private key, stores CryptoKeys in memory
- [x] Task 3.5: Updated LoginPage, CredentialsPage, DashboardPage, SettingsPage
- [x] Task 3.6: Created `useVaultKey` Zustand store (replaces `useMasterPassword`)
- [x] Task 3.7: Rewrote `useCredentialCrypto` for hybrid RSA+AES encryption
- [x] Task 3.8: Removed frontend components for sharing, emergency, backup, TOTP, MFA

### Phase 4: Test & Documentation Cleanup

- [x] Task 4.1: Deleted test files for removed features
- [x] Task 4.2: Updated all test fixtures (OAuth user creation, direct JWT tokens)
- [x] Task 4.3: Removed password-based auth from integration tests
- [x] Task 4.4: Updated documentation

## Files Changed

### Backend — Deleted
| File | Description |
|------|-------------|
| `app/core/crypto.py` | SSE encryption (AES-256-GCM with ENCRYPTION_KEY) |
| `app/core/mfa.py` | TOTP MFA utilities |
| `app/api/v1/sharing.py` | Credential sharing endpoints |
| `app/api/v1/emergency.py` | Emergency access endpoints |
| `app/api/v1/backup.py` | Server-side backup endpoints |
| `app/api/v1/totp.py` | TOTP authenticator endpoints |
| `app/services/sharing.py` | Sharing service |
| `app/services/emergency.py` | Emergency access service |
| `app/services/backup.py` | Backup service |
| `app/services/totp_service.py` | TOTP service |
| `app/schemas/sharing.py` | Sharing schemas |
| `app/schemas/emergency.py` | Emergency schemas |
| `app/schemas/backup.py` | Backup schemas |
| `app/schemas/totp.py` | TOTP schemas |
| `app/models/credential_share.py` | Share model |
| `app/models/emergency_access.py` | Emergency access model |
| `app/models/totp_account.py` | TOTP account model |

### Backend — Modified
| File | Description |
|------|-------------|
| `app/models/user.py` | Added E2EE + OAuth columns, removed MFA fields |
| `app/schemas/auth.py` | Replaced password/MFA schemas with OAuth/Vault schemas |
| `app/schemas/user.py` | Removed password from UserCreate, added has_vault_keys |
| `app/config.py` | Removed ENCRYPTION_KEY, MFA; added Google OAuth settings |
| `app/api/v1/auth.py` | Removed login/MFA/password endpoints; added vault/setup |
| `app/api/v1/router.py` | Removed old routes, added OAuth route |
| `app/services/user.py` | Added OAuth user creation, vault key setup |
| `app/services/bootstrap.py` | OAuth-based admin auto-promotion |
| `app/core/security.py` | JWT-only (removed password hashing) |
| `app/cli.py` | Updated create-admin for OAuth users |

### Backend — Created
| File | Description |
|------|-------------|
| `app/api/v1/oauth.py` | Google OAuth 2.0 endpoints |
| `alembic/versions/003_e2ee_migration.py` | E2EE schema migration |

### Frontend — Deleted
| File | Description |
|------|-------------|
| `src/pages/MFAPage.tsx` | MFA setup page |
| `src/components/SharingPanel.tsx` | Sharing UI |
| `src/components/EmergencyAccessPanel.tsx` | Emergency access UI |
| `src/components/BackupRestorePanel.tsx` | Backup/restore UI |
| `src/components/TOTPAuthenticator.tsx` | TOTP authenticator UI |
| `src/services/sharingService.ts` | Sharing API client |
| `src/services/emergencyService.ts` | Emergency API client |
| `src/services/backupService.ts` | Backup API client |
| `src/services/totpService.ts` | TOTP API client |
| `src/hooks/useMasterPassword.ts` | Old master password store |

### Frontend — Modified
| File | Description |
|------|-------------|
| `src/lib/crypto.ts` | Complete rewrite: PBKDF2 + RSA-OAEP + AES-256-GCM hybrid |
| `src/hooks/useCredentialCrypto.ts` | RSA hybrid encrypt/decrypt |
| `src/pages/LoginPage.tsx` | Google OAuth flow |
| `src/pages/DashboardPage.tsx` | Removed MFA/sharing widgets |
| `src/pages/SettingsPage.tsx` | Vault encryption status |
| `src/pages/AdminUsersPage.tsx` | Vault status column |
| `src/components/MasterPasswordModal.tsx` | RSA keypair generation + vault unlock |
| `src/types/index.ts` | OAuth/vault types, removed MFA/sharing types |
| `src/stores/authStore.ts` | Removed MFA state |
| `src/services/authService.ts` | Google OAuth + vault setup |

### Frontend — Created
| File | Description |
|------|-------------|
| `src/hooks/useVaultKey.ts` | Zustand store for CryptoKey management |

## Technical Decisions (Final)

1. **PBKDF2 for Key Derivation**: Used instead of Argon2id due to native Web Crypto API support (no WASM dependency). 600,000 iterations with SHA-256. Argon2id can be added later.
2. **RSA-OAEP 2048-bit**: Asymmetric keypair for wrapping per-credential AES keys.
3. **AES-256-GCM**: Per-credential symmetric encryption with random key.
4. **Hybrid Encryption**: Each credential gets a random AES key, encrypted with RSA public key.
5. **Partial Blind Storage**: Server can read metadata (name, URL, category) for server-side search. Only `encrypted_data` is opaque.

## Encryption Flow

### Vault Setup (first login)
1. User authenticates via Google OAuth → JWT issued
2. Frontend prompts for Vault Password
3. `deriveKEK(password, salt)` → AES key (PBKDF2, 600K iterations)
4. `generateKeyPair()` → RSA-OAEP 2048 public/private key pair
5. Private key encrypted with KEK → `encrypted_private_key`
6. Public key, encrypted private key, salt sent to server

### Vault Unlock (subsequent logins)
1. User authenticates via Google OAuth → JWT issued
2. Frontend fetches user's encrypted_private_key, key_salt, public_key from server
3. User enters Vault Password
4. `deriveKEK(password, salt)` → KEK
5. `importEncryptedPrivateKey(encrypted_private_key, KEK)` → CryptoKey
6. Keys stored in memory (Zustand store, 15-min timeout)

### Credential Encrypt
1. Serialize credential fields to JSON
2. Generate random 256-bit AES key
3. Encrypt data with AES-256-GCM using random key
4. Wrap random AES key with RSA-OAEP public key
5. Concatenate: `[wrappedKeyLen(4 bytes)][wrappedKey][iv(12 bytes)][ciphertext]`
6. Base64 encode → store as `encrypted_data`

### Credential Decrypt
1. Base64 decode `encrypted_data`
2. Parse: extract wrapped key, IV, ciphertext
3. Unwrap AES key with RSA-OAEP private key
4. Decrypt ciphertext with AES-256-GCM
5. Parse JSON → credential fields

## Progress Log

| Date | Update |
|------|--------|
| 2026-03-03 | Plan created by Gemini |
| 2026-03-03 | Plan reviewed by Claude — 12 issues identified and resolved |
| 2026-03-03 | Implementation completed by Claude |

---

*Created: 2026-03-03*
*Author: Gemini (Conductor)*
*Implemented by: Claude (Specialist)*
