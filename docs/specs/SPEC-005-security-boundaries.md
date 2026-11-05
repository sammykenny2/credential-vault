# SPEC-005: Authentication, operation and backup boundaries

## Metadata

| Field | Value |
|-------|-------|
| Status | Implemented and independently reviewed; deployment pending |
| Related decision | [ADR-005](../decisions/005-session-and-operation-boundaries.md) |
| Related plan | [PLAN-005](../plans/PLAN-005-security-review-hardening.md) |

## Summary and goals

Bind asynchronous work to the account and unlock that started it. Make session
revocation durable, refuse refresh replay and implicit identity replacement, and
ensure a complete backup includes revoked records and every page.

## Non-goals

Attachments, collections, ZIP v2, protection against replaced frontend code,
and proving freshness/completeness against a malicious data server remain outside
this change. Multi-batch restore is not atomic; SPEC-004 staging remains pending.

## Requirements

1. Closing a dialog, unmounting, locking, timing out or changing the authentication
   session invalidates outstanding plaintext operations. HTTP responses/retries
   and every restore batch share the originating operation's cancellation signal.
   Finished operations release retained key references. Responses/retries
   retain their original authentication and vault generations. Refresh never
   resurrects a logged-out session or adopts another cookie owner's identity.
2. Vault setup requires `X-Vault-Setup`, a ten-minute JWT with purpose `vault-setup`
   bound to user, token version and refresh-family ID. Only interactive login or
   initial admin creation issues it, and only for an account without vault keys.
   Refresh returns no setup authorization. The browser keeps it only in memory;
   reload/expiry requires signing in again. Conditional key installation consumes
   the empty-vault state, so concurrent/replayed setup cannot replace keys.
3. Every security mutation commits before a successful response. Database yield
   dependencies use function scope; logout additionally commits explicitly and
   increments token_version atomically. A failure locks the local device but the
   UI must not claim server revocation succeeded. Logout refused for an expired
   access token exchanges the refresh cookie once and retries, without restoring
   local state, and only if the cookie still belongs to the same account.
4. The first-admin claim is unique and transactional. Configured ADMIN_EMAIL
   disables public password setup. Startup commits configured bootstrap state.
   Google subjects are immutable through login: matching email cannot silently
   link or replace one. Explicit initial linking requires password verification,
   a five-minute purpose-bound authorization and a matching Google email.
   Empty, never-used USER invitations may be initially claimed only with an
   authoritative Google email; the same conditional UPDATE requires active status,
   null subject/password/login/vault/proof fields, token_version zero, and no
   credential rows. Existing identity or data always prevents implicit claiming.
5. Refresh consumes a stored token hash by conditional UPDATE, preserving the
   family's original absolute expiry. Replay receives no new tokens. A five-second
   concurrent-use window returns 409 without revoking the winner; later replay
   revokes the family. Web Locks serialize browser tabs when supported.
6. All `/api/` requests share the configured per-client-IP minute budget, resolved
   through trusted proxies. Auth decorators add 10/minute limits. Health is exempt.
   Argon2 work runs off the event loop with at most two concurrent jobs. Failed
   authentication audit events persist across HTTP errors; ciphertext list/export
   audit details contain only counts and visible encoded byte lengths.
7. Backup export fetches every page including revoked records, checks signatures
   before decrypting, and compares the signed snapshot again before download.
   Duplicate IDs, more than 10,000 records, any invalid record or a changed snapshot
   stop export without marking the backup reminder complete.
   The ciphertext export endpoint also includes revocation and refuses more than
   10,000 records instead of silently truncating.
8. New text-only backups use JSON `type: credential-record-backup`, `version: 1`,
   Argon2id KDF v2 and AES-256-GCM with UTF-8 AAD
   `credential-vault/record-backup/1`. This distinct type makes old clients refuse
   the file instead of silently losing status, and does not allocate ZIP v2.
   The encrypted payload retains data, created_at, expires_at, is_active,
   revoked_at and source_origin. New passwords require 12 characters; files are
   bounded at 32 MiB. Legacy `credential-backup` v1 stays readable with its original
   password and lacks revocation status. Decrypted content and counts are validated.
9. Restore preserves revocation for new backups. Both formats restore as
   `legacy-unverified`: backup password authentication does not independently prove
   original authorship. Batches stay below nginx's 1 MiB request limit (at most
   500 records), and the backend authenticates/proves unlock before streaming and
   counting the body. Read-back must match each signed ciphertext/revision/signature
   before reporting success. A failed restore may leave completed batches; warn
   users to inspect before retrying. Rate-limit retries remain bound to the same
   session and unlock and are bounded.

## Acceptance and verification

Regressions exercise real ASGI request teardown, commit failure, concurrent admin
claims and refresh consumption, an old Google subject with the same email,
token-only vault setup, delayed unlock/restore across account changes, more than
100 records, revoked status, changed snapshots and invalid backup content.
Migration tests must preserve existing ciphertext and require a fresh sign-in for
old stateless refresh cookies. Independent review and release/deployment evidence
remain separate from author-run tests.

*Created: 2026-11-05*
