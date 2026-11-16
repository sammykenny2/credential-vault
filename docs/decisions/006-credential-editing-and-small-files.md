# ADR-006: Credential editing and bounded embedded file fields

> Architecture Decision Record

## Status

Accepted after independent review (2026-11-16). Release still requires passing
regression checks and CI. The user requested editing existing
credentials, file custom fields, CI publication, and deployment to this machine.

## Context

Existing credentials are encrypted flat string maps. The backend already accepts
signed updates with an atomic revision check, but the frontend only exposes create,
revoke and delete. File custom fields were previously described as complete even
though only ADR-003 / SPEC-004 / PLAN-004 existed.

OAuth client JSON and small key files need a usable save/download path. The proposed
10 MiB standalone attachment system also includes staging, quotas, collections,
new envelopes and ZIP backups. Its gates remain closed and that work is not
declared complete by this release.

## Decision

- Deliver a bounded file field inside the existing signed credential ciphertext:
  128 KiB per original file, 256 KiB original bytes per record, at most five files.
  The UI explicitly states these limits. This focused release supersedes the
  proposed ADR-003 separate-storage choice only for files within these bounds.
- Keep `fields: Record<string, string>`. Add encrypted `fieldOptionsVersion: 1`
  and `fieldOptions` entries identifying text/file, secret masking, and required
  status. Legacy records omit both properties and keep their existing reader.
  Unknown option versions and structured schema versions fail closed.
- Each file value is JSON containing `version: 1`, filename, original byte length
  and canonical Base64 of bytes randomly padded to a 4 KiB boundary (minimum one
  block). Filename, exact length, content and options are encrypted together.
  There is no plaintext file upload endpoint, independent file key or database
  migration. Saving generates a new credential AES key and IV, and the existing
  credential ID remains authenticated as additional data. Ciphertext signatures
  cover the complete content and signed state.
- Edit from the exact verified record the user opened. Preserve ID, expiry,
  revocation and source-origin status. Increment revision, require vault proof,
  and verify the read-back. Never fetch a substitute source record before signing,
  silently retry conflicts, or roll back with an unconditional overwrite.
- Preserve explicit masking across field renames. Enforce unique trimmed labels,
  at most 50 fields, and required values. Required fields cannot be removed in the
  credential editor. Legacy records have no stored required flags; do not infer
  them from a possibly changed template. Optional fields can be added or removed;
  notes-only and file-only records are supported.
- Capture session/unlock generations before asynchronous work. Cancel work when a
  dialog closes/unmounts or the vault/account changes. Clear the parent editor's
  plaintext on close/lock. Do not log file bytes or decrypted values on failures.
- Download only on an explicit user action and confirmation that a plaintext copy
  will be created. Force `application/octet-stream`, clean filename path separators,
  controls and bidi characters, and revoke the Blob URL. No preview or execution.
- Existing record backup JSON retains the entire credential object, so embedded
  file bytes and options travel with the backup and restore under newly generated
  record IDs and destination keys. Keep the existing 32 MiB backup file limit and
  report failures without silently omitting files. ZIP v2 remains separate work.
- Templates hold definitions only: optional `type: text | file` defaults to text.
  The backend marks file definitions secret and rejects file defaults even if a
  caller incorrectly marks them nonsecret. Google OAuth and service-account
  templates gain optional JSON file fields. Template edits do not rewrite records.

## Consequences

### Positive

- Editing and small-file downloads work with existing signing/proof/CAS boundaries.
- Metadata and files save atomically in one existing credential write; backups
  cannot omit an independently stored attachment.
- New create/update ciphertext is limited to 880,000 Base64 characters, reserving
  enough space for signatures and restore metadata under the 900,000-byte import
  batching budget and nginx's 1 MiB request limit.
- No new dependencies, listeners, backend secret processing or data migration.

### Negative

- Lists load the bounded embedded file payload with each credential. Base64 adds
  storage overhead. Large vaults with many files require the standalone design.
- Deleting a field does not erase values in previously exported backups.
- Old bundles can display the encoded file as text and lack the file download UI;
  users must reload after deployment. Existing backup readers preserve the object.

### Neutral

- Existing anti-replay limitations and the visibility of total ciphertext sizes,
  ownership, timestamps and access patterns remain; revision conflicts do not
  promise protection against a malicious server replaying an older signed state.

## Alternatives Considered

1. Implement all of PLAN-004 now: its unresolved prerequisites and much broader
   scope are unnecessary for bounded OAuth JSON; keep that plan explicitly pending.
2. Put file contents in templates or send plaintext to a new API: violates the
   zero-knowledge boundary and is rejected.
3. Save only a filename/path: cannot recover the original bytes and is rejected.

## References

- [ADR-001](001-e2ee-architecture.md), [ADR-004](004-vault-authenticity-and-key-trust.md),
  [ADR-005](005-session-and-operation-boundaries.md)
- [SPEC-006](../specs/SPEC-006-credential-editing-and-small-files.md)
- [PLAN-006](../plans/PLAN-006-credential-editing-and-small-files.md)
- [PLAN-004](../plans/PLAN-004-structured-credentials-and-attachments.md)
