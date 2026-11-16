# SPEC-006: Credential editing and small file custom fields

## Metadata

| Field | Value |
|-------|-------|
| Status | Implemented and deployed in v0.5.0, 2026-11-16 |
| Owner | Project maintainer |
| Reviewer | Independent review complete; see PLAN-006 |

Decision: [ADR-006](../decisions/006-credential-editing-and-small-files.md).
Deployment evidence: [PLAN-006](../plans/PLAN-006-credential-editing-and-small-files.md).

## Summary

An unlocked owner can edit an existing credential's details, field names and values,
add optional text/file fields, remove optional fields, and replace or remove files.
Persist required and secret flags; a rename must not reveal a previously masked
secret. Legacy records remain readable and are extended only on explicit save.

Files are opaque bytes: 128 KiB/file, five files/record and 256 KiB combined original
bytes. Preserve empty files, binary bytes, whitespace and newlines. Store filename,
original byte length, 4 KiB padded bytes and field options only inside ciphertext.
File selection never submits to the backend before encryption. Download requires
an explicit action and plaintext-copy confirmation, uses an inert MIME type and
safe filename, and cleans up its Blob URL. Files are not previewed or parsed.

The template editor exposes Text/File, Secret and Required; definitions contain no
real values. Google OAuth and Google Service Account include optional JSON fields.

## Goals

- Edit existing records and optional fields without recreating the credential.
- Preserve small file bytes and encrypted backup/restore with existing signing,
  ownership, revision and session boundaries.

## Requirements and Acceptance

1. A save updates the original ID, increments the reviewed revision, preserves
   signed expiry/revocation/origin, requires proof, and verifies the stored result.
2. Tampered source records are refused before signing. No fresh GET can substitute
   another source record. A conflict preserves local edits and does not overwrite.
3. Duplicate/blank field names, missing required values, unknown field formats,
   malformed file encodings and oversized files are rejected with actionable text.
4. File and field changes are atomic with the rest of the existing record.
5. Lock, logout, account change or close/unmount cancels pending file/encryption
   work; parent views discard plaintext on close/lock.
6. Files survive encrypted save/read, backup/restore and re-encryption under another
   account's keys, retaining original bytes, flags and revoked status.
7. Required fields cannot be removed; optional fields can. New fields are optional.
8. Backend template validation rejects file defaults even when `isSecret` is false.
9. Frontend lint/build/tests and backend lint/types/tests pass, independent review
   is complete, CI release passes, and deployment version/health/cache policy is
   recorded before claiming this is available on the current machine.

## Non-Goals

Standalone 10 MiB attachments, collection/section graphs, ZIP backup v2, file
previews, vendor-JSON parsing and automatic population of credential values.
SPEC-004 / PLAN-004 remain pending for that broader system.

## Design and Dependencies

ADR-006 extends the existing encrypted string map with versioned rendering options;
files remain inside the signed ciphertext. Existing Web Crypto, operation guards,
vault proof and backend compare-and-swap updates are reused without new packages,
listeners or migrations. ADR-007 records the independently reviewed, CI-tested
Python container runtime needed for the release scan.

## Open Questions

None for this bounded release. The broader SPEC-004 design remains separate.
