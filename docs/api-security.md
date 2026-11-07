# Authentication and credential API contracts

Base path: `/api/v1`. This documents implemented security-sensitive contracts;
the general `api.md` remains a template. All API responses use `Cache-Control:
no-store`. Errors use FastAPI's `detail` field. No endpoint receives credential
plaintext or a vault/backup password.

| Endpoint | Authorization and behavior |
|----------|----------------------------|
| `GET /setup/status` | Returns `is_initialized` and `can_create_admin`; does not disclose the configured admin address. |
| `POST /setup/admin` | Only during unconfigured first-run; unique transactional claim. ADMIN_EMAIL disables it. |
| `POST /auth/login` | Admin sign-in password; one Argon2 verification on known/unknown accounts; failures audited. |
| `POST /oauth/google/callback` | Exchanges a Google code server-side. Login matches the stable subject; an existing email with another subject returns 409. |
| `POST /auth/refresh` | HttpOnly refresh cookie only. Atomically consumes its identifier. Returns 409 on immediate concurrent use, 401 on invalid/expired/replayed family. Old stateless refresh cookies require signing in again. |
| `POST /auth/logout` | Bearer access token. Atomically increments token_version and commits, revoking all account sessions and proofs, then expires the cookie. Failure must not be presented as successful server revocation. The browser retries a 401 once after exchanging its refresh cookie, if that cookie is still the same account's. |
| `POST /auth/vault/setup` | Bearer token plus `X-Vault-Setup` from the same interactive login family, valid for ten minutes. Refresh never issues this authorization. The empty vault can be configured only once. Missing/invalid authorization returns 403 with `vault_setup_authorization_required`. |
| `POST /auth/verify-password` | Bearer token plus the account sign-in password. Returns `verified` and a five-minute `link_token` with purpose `google-link`. |
| `POST /users/me/link-google` | Bearer token plus `{code, redirect_uri, link_token}`. The Google email must match; an existing real Google subject cannot be replaced. The token_version and unlinked state are checked atomically. |
| `GET /credentials/` | Owner-scoped ciphertext; `skip >= 0`, `limit` 1–500 (default 100), `include_revoked` default false. Ordering is created_at descending, then ID. Enumeration is audited by count/encoded size. |
| `GET /credentials/export` | Includes complete signed states and revoked records. More than 10,000 returns 413; use paginated listing. Audited by count/encoded size. |
| `POST /credentials/import` | Bearer token plus vault proof v2. Auth/proof run before body streaming. Maximum 1 MiB, 500 signed records; includes is_active/revoked_at. Each batch commits atomically, but multiple batches are not one transaction. |

Successful interactive login/setup returns `access_token`, `token_type`,
`expires_in`, `user_id`, and `vault_setup_token` (null if a vault already exists).
Refresh returns the same shape with a null setup token. The refresh token only
travels in a HttpOnly, SameSite=Strict cookie scoped to `/api/v1/auth`, Secure in
production. Its family expires at the original sign-in deadline, default seven
days; rotation does not extend it. Access tokens retain the family ID so replay
revocation invalidates that family's access too.

Email-based first enrollment is limited to unused ordinary invitations: active
USER, no subject/password/login history/vault/proof material, token_version zero,
and no credentials. The callback requires Google authority for the email
(Gmail/Workspace) and claims by conditional UPDATE. This exception never replaces
an identity. For other email providers, sign in with Google before provisioning;
administrators can manage the registered account afterward.

`RATE_LIMIT_PER_MINUTE` (default 60) is shared across all API paths by trusted
client IP. Login, callback, password verification, refresh and initial setup also
have 10/minute endpoint counters. `/health` is exempt. One worker is required for
in-memory counters. API-wide 429 responses include `Retry-After`; the browser
allows at most two delayed retries per request, checking the original account and
unlock generation before sending again. Long restores can pause under this budget.

All credential write signatures, vault proof and key trust still follow
[ADR-004](decisions/004-vault-authenticity-and-key-trust.md).
See [SPEC-005](specs/SPEC-005-security-boundaries.md) for backup formats and limits.

*Last updated: 2026-11-07. Deployed in v0.4.2; verified in a browser on v0.4.3.*
