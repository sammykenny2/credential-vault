# PLAN-006: Credential editing and small files

Status: implementation in progress (2026-11-16).
Scope: [SPEC-006](../specs/SPEC-006-credential-editing-and-small-files.md).
Decision: [ADR-006](../decisions/006-credential-editing-and-small-files.md).

## Tasks

- [x] Connect Edit in the record menu and detail view to the existing verified row.
- [x] Add signed update service; preserve status and use existing revision checks.
- [x] Persist text/file, secret and required options in encrypted credential data.
- [x] Add bounded file selection, replacement, removal and safe explicit download.
- [x] Extend template definitions/editor and Google JSON file fields.
- [x] Add regressions for updates, conflicts, file limits, padding, masking, async
  cancellation and encrypted backup/restore across destination keys.
- [ ] Run frontend build/lint/tests and backend lint/type/tests; fix failures.
- [x] Complete independent review and resolve findings.
- [ ] Publish a versioned commit, push, and verify CI/release.
- [ ] Deploy the CI images to this machine with a pre-deploy backup; record actual
  version/revision, container health and served cache/security headers.

## Deployment record

Not deployed yet. Do not mark the features available based on implementation alone.

## Independent review

Read-only review completed 2026-11-16, with no remaining blocking findings after
fixes: ignore file-template defaults, require exact string field types, replace
parse errors that can disclose input, align save size with restore capacity, and
clarify cancellation after an accepted save. Parser fixes were checked directly
with Node; full tests and release checks are separate tasks above.

## Recovery

Use the existing deployment helper's saved pre-deploy database/images for an
explicit rollback if required. No migration or automatic data reset is introduced.
Closing an editor discards unsent local edits. A save already accepted by the server
can still have landed even if the dialog closes before read-back confirms it;
reopen the credential to check the stored state. Cancellation cannot recall an
already accepted request and never triggers an unconditional rollback.
Previously exported backups can still contain removed fields/files.
