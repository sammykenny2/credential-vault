# PLAN-005: Security review hardening

## Metadata

| Field | Value |
|-------|-------|
| Status | Implemented and independently reviewed; deployment pending |
| Scope | Findings from the 2026-11-05 review, based on main e4dee31 |
| Review | Independent review completed; findings resolved and rechecked |

## Overview

Related specification: [SPEC-005](../specs/SPEC-005-security-boundaries.md).

Isolate this work in `fix/security-review-hardening`. Preserve the separate
`feat/vault-setup-step-up` worktree. Its uncommitted work is not part of this change;
its later integration must retain the independent setup authorization.
Do not publish exploit scripts or claim deployment based on local tests.

That integration has happened. It kept `X-Vault-Setup` and dropped the branch's
`auth_time` check, which added no protection on top. It added what this plan lacked:
logout that gets through with an expired access token, the failed-logout warning that
never reached the screen, a password sign-in link on the login page, and tests for each
sign-in path and the setup authorization's limits.

## Implementation phases

- [x] Bind browser operations and HTTP retries to an authentication generation;
  bind plaintext operations to one unlock generation. Cancel on close, unmount,
  lock, timeout and logout; clear account-scoped query caches.
- [x] Commit bootstrap and security mutations before successful responses;
  serialize first-admin claims and respect configured administrator identity.
- [x] Reject implicit Google subject rebinding. Protect explicit linking with
  password verification authorization and reject replacing an existing Google subject.
- [x] Persist failed authentication audits; audit ciphertext enumeration without
  recording secrets, tokens or request bodies.
- [x] Install API-wide rate-limit middleware, bound password work off the
  event loop and test actual middleware behavior.
- [x] Rotate refresh tokens with an atomic database comparison, absolute expiry
  and replay handling; coordinate browser tabs and document reauthentication.
- [x] Export all records including revoked records, refuse incomplete backups,
  preserve status and validate decrypted backup structure before restoring.
- [x] Add independent, session-bound first-vault setup authorization, issued only
  after interactive login. The separate worktree's recent-login changes remain
  untouched; resolve overlaps when integrating branches.
- [x] Run focused regressions, backend/frontend checks, migration checks and
  independent review; update public API/security docs with the final behavior.

## Verification record

- Backend: 329 tests passed, including Alembic schema agreement, ciphertext
  preservation, unsafe downgrade refusal, real transaction teardown and CAS races.
- Frontend: 366 tests passed with two workers and a 30-second timeout. The first
  full run hit two default five-second timeouts under concurrent checks and one
  outdated message assertion; the corrected full run passed.
- Independent review found operation lifetime/retention, batch cancellation,
  OAuth callback initialization, empty-invitation compatibility and lock-screen
  password retention issues. All were fixed and independently rechecked.
  Synthetic tests confirmed no second upload after cancellation and that only a
  completely unused ordinary account can be claimed. No production service was tested.
- Ruff, mypy, frontend lint and the final production build passed. The pinned
  uv lock check, frozen Python dependency audit and production npm audit passed;
  neither dependency audit reported known vulnerabilities. The final focused
  backend run passed all 24 security boundary cases.
- Deployment verification and attachment format approval remain separate. This
  commit does not bump VERSION or create a release; existing sessions must sign
  in again when the new schema/backend are deployed with the matching frontend.

## Testing strategy

Use synthetic identities and keys. Exercise production ASGI transaction teardown,
commit failures, competing first-admin/refresh requests, Google subject changes,
delayed browser operations across account changes, more than 100 records and
revoked records. Do not access the real database, IdP accounts or deployed NAS.

## Risks and mitigations

Session schema changes invalidate existing refresh cookies and require signing
in again. Browser cancellation cannot recall a request already accepted by the
server, but must prevent every subsequent side effect and plaintext publication.
Signatures cannot prove completeness or freshness against a malicious server;
backup completeness checks catch honest-server paging and concurrent changes.
Attachment ZIP v2 remains the separate SPEC-004 project.

*Created: 2026-11-05*
