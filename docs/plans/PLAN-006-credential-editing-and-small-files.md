# PLAN-006: Credential editing and small files

## Metadata

| Field | Value |
|-------|-------|
| Status | Completed; deployed v0.5.0 on 2026-11-16 |
| Owner | Project maintainer |
| Reviewer | Independent reviews complete; no remaining blocking findings |

Scope: [SPEC-006](../specs/SPEC-006-credential-editing-and-small-files.md).
Decision: [ADR-006](../decisions/006-credential-editing-and-small-files.md).

## Implementation Phases

### Editing and small file fields

- [x] Connect Edit in the record menu and detail view to the existing verified row.
- [x] Add signed update service; preserve status and use existing revision checks.
- [x] Persist text/file, secret and required options in encrypted credential data.
- [x] Add bounded file selection, replacement, removal and safe explicit download.
- [x] Extend template definitions/editor and Google JSON file fields.
- [x] Add regressions for updates, conflicts, file limits, padding, masking, async
  cancellation and encrypted backup/restore across destination keys.

### Validation and deployment

- [x] Run frontend build/lint/tests and backend lint/type/tests; fix failures.
- [x] Complete independent review and resolve findings.
- [x] Publish a versioned commit, push, and verify CI/release.
- [x] Deploy the CI images to this machine with a pre-deploy backup; record actual
  version/revision, container health and served cache/security headers.

## Deployment record

Deployed to the existing local Docker stack on 2026-11-16 with
`Deploy-CredentialVault.ps1 -Tag 0.5.0`. Build provenance for both images was
verified before replacing the running containers.

| Evidence | Result |
|----------|--------|
| Version / source | `0.5.0` / `c94154e3f5b8da3e7604cc18f4213ead65cb1d7c` |
| Backend digest | `sha256:adfc18f05b5942a4a5d7d76e5536f3e7ede1c4d4ef30286dfcdea8d8338acee3` |
| Frontend digest | `sha256:ff5b8964c16a9d23735e48607d52452a3af00b1a8bec70155491acc2e8170324` |
| Pre-deploy backup | `backups/pre-deploy-20261116-155450.db`, schema `8b5f2d0e3c71` |
| Container checks | Tailscale, backend and frontend healthy; both app images report the release version/revision |
| Served checks | `/health` reports healthy, production, database connected, exact release version/revision; setup status responds |
| Cache/security headers | Document, CSP and service worker cache checks passed |
| Runtime smoke | Exact CI backend image booted with synthetic settings and database, no network/host ports/production volume; health and Python 3.15.2 / uvloop / httptools checks passed; temporary container removed |
| Recovery | Prior running backend/frontend retained as `:previous`; pre-deploy database backup retained |

Feature regressions ran in CI with synthetic data. No real credential was edited
to perform deployment verification. Existing standalone-attachment PLAN-004 remains
pending; this release implements only the bounded file fields in ADR-006.

## Independent review

Read-only review completed 2026-11-16, with no remaining blocking findings after
fixes: ignore file-template defaults, require exact string field types, replace
parse errors that can disclose input, align save size with restore capacity, and
clarify cancellation after an accepted save. Parser fixes were checked directly
with Node; full tests and release checks are separate tasks above.

## Validation

- PR #20 first CI run: frontend 426 tests / 28 files passed, lint and production
  build passed; backend 342 tests passed, Ruff/format and mypy passed.
- The first security audit found existing dnspython / opentelemetry-api issues;
  update the lockfile to 2.9.2 / 1.45.2 and require a clean audit before release.
  [Audit sources](../research/2026-11-16-release-dependency-audit.md).
- The initial image scan blocked Python 3.14.10. ADR-007 moved the container to
  stable 3.15.2 and added a 3.15 CI job alongside 3.14; independent review, both
  interpreter jobs, frontend checks, dependency audit, Docker builds and the
  unchanged release image scan all passed. [Release CI](https://github.com/sammykenny2/credential-vault/actions/runs/43825765490).
- Release [v0.5.0](https://github.com/sammykenny2/credential-vault/releases/tag/v0.5.0)
  published 2026-11-16 from `c94154e3f5b8da3e7604cc18f4213ead65cb1d7c`.
- Local Windows build, mypy and Ruff passed. Initial local suites encountered
  sandbox temporary-directory errors and crypto timeouts; the complete clean CI
  runs above are the regression evidence. Superseded local retries were stopped.

## Technical Decisions and Risks

- ADR-006 bounds embedded file payloads so existing atomic signed writes and JSON
  backup/restore can be retained. Lists still carry bounded file data; larger file
  storage remains a separate design.
- ADR-007 updates the runtime within the supported Python range and tests both
  interpreters. Production entrypoint and deployed health were checked above.
- Older downloaded backups can retain deleted fields/files. In-flight accepted
  saves cannot be recalled; conflicts and uncertain results never trigger blind
  overwrites.

## Recovery

Use the existing deployment helper's saved pre-deploy database/images for an
explicit rollback if required. No migration or automatic data reset is introduced.
Closing an editor discards unsent local edits. A save already accepted by the server
can still have landed even if the dialog closes before read-back confirms it;
reopen the credential to check the stored state. Cancellation cannot recall an
already accepted request and never triggers an unconditional rollback.
Previously exported backups can still contain removed fields/files.
