# ADR-005: Session and operation boundaries

## Status

Accepted and implemented; independent review completed, deployment pending.

## Context

A vault signature authenticates a record, but does not bind an asynchronous UI
operation to the account and unlock that started it. Authentication also needs
durable revocation and a stable identity independent of an email address.

## Decision

Browser operations capture authentication and vault generations. Closing a
dialog, unmounting, locking or changing accounts invalidates outstanding work.
Every continuation checks before publishing plaintext, signing, downloading or
sending a later request. HTTP refresh and retries retain the original account.
Account changes clear query caches. Requests already accepted cannot be recalled.
Finished operations release key references; cancellation propagates through batch
services and HTTP retries. Password changes with an uncertain response must say
that the new password may already be in effect.

Refresh sessions are persisted with an absolute expiry, a random family ID and
the hash of the currently accepted token identifier. Rotation uses a conditional
UPDATE; only one caller consumes a token. Replay outside a five-second concurrency
window revokes that family. Within the window a loser gets 409 and no tokens;
there is no grace-period token issuance. Browsers serialize refresh using Web
Locks where available. Expired session rows are pruned on issuance. Old stateless
refresh tokens require a new sign-in. Account logout increments token_version
atomically and commits before reporting success.

The first-admin claim is a single database row, inserted in the same transaction
as account creation/promotion. Configured ADMIN_EMAIL disables unauthenticated
password setup; typing that address does not prove ownership. Startup bootstrap
commits before serving requests. Google subjects cannot be implicitly replaced.
Linking a previously unlinked local account requires a short-lived, purpose-bound
authorization issued only after password verification, then an OAuth code for
the same email; the callback consumes the unlinked state with a conditional UPDATE.
An admin-precreated ordinary account may be claimed for the first time only when
Google is authoritative for the email (verified Gmail/Workspace). One conditional
UPDATE requires an active USER, no Google subject, password, login history,
revocation history, vault/proof key material or credential rows. This is enrollment
of an empty invitation, never recovery or reassignment of an existing identity.
Other email providers should register through Google first; operators can then
manage that account. Legacy placeholders with any identity/data need explicit
account recovery, not relaxed matching. The link callback waits for session
bootstrap and user loading before consuming its tab-bound OAuth state.

First-vault setup additionally needs an independent ten-minute authorization in
`X-Vault-Setup`, bound to the user, token version and login family. Only interactive
login issues it; refresh never does. Installing keys consumes the empty-vault state
by conditional UPDATE. It remains a bearer authorization: stealing both tokens,
or compromising the unlocked frontend, is outside the token-only protection.

Default request limits run as middleware using SlowAPI's public limits backend;
the stock middleware cannot discover FastAPI 0.162 included-router handlers.
The configured budget is shared across API paths for each trusted client IP.
Password verification/hashing uses a
bounded worker pool so Argon2 does not block the event loop or exhaust memory.
Authentication failures commit their audit event before raising an HTTP error.
Ciphertext enumeration logs count and visible byte size, never plaintext or tokens.

## Consequences

### Positive

Operations cannot silently move between accounts or unlocks. A successful logout
means revocation committed. Refresh replay and Google identity changes fail closed.

### Negative

Existing refresh cookies stop working on upgrade. Multi-tab contention without
Web Locks may require a retry. Lost refresh responses can require reauthentication.
Blocking server-side sessions does not erase ciphertext already downloaded.

### Neutral

These controls do not change credential cryptography or promise rollback detection
against a malicious server. A fresh access-token timestamp alone is not independent
identity verification. Text-only backup status uses a distinct JSON type with AAD
([SPEC-005](../specs/SPEC-005-security-boundaries.md)); old readers refuse it, old
backups stay readable, and the planned attachment ZIP v2 is not redefined.

## Alternatives considered

Sliding, stateless refresh tokens were rejected because a copied cookie remains
reusable. Accepting a recently consumed refresh token was rejected because that
would also issue tokens to a replayer. Email-only account linking was rejected
because an email is not Google's stable account identifier. A sign-in time claim in
the access token (`auth_time`) was built for first-vault setup and dropped before it
shipped: the setup authorization already expires ten minutes after that login and is
bound to its family, so the claim would add a second refusal and no protection.

## References

- [ADR-004](004-vault-authenticity-and-key-trust.md)
- [PLAN-005](../plans/PLAN-005-security-review-hardening.md)
- [Google identity verification](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token)
- [SlowAPI default-limit middleware](https://slowapi.readthedocs.io/en/latest/examples/)

*Created: 2026-11-05; external references checked on that date.*
