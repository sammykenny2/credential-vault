# Agent Guide

Read root `AGENTS.md` and your own agent file first. Customize this guide with
project-specific procedures that are too detailed for always-loaded instructions.

## Project Context

- What it is: a self-hosted credential vault for personal/team secrets, deployed
  to a NAS with Docker Compose and reached only through Tailscale. Users sign in
  with Google OAuth; an admin can manage users but cannot read anyone's
  credentials. Each user has a personal vault with create/update/revoke/delete.
- Encryption model (ADR-001, SPEC-003): the browser derives a key-encryption key
  from the vault password with Argon2id (64 MiB, 3 iterations), wraps an RSA-2048
  private key with AES-256-GCM, and encrypts every credential with a random
  AES-256-GCM key wrapped by RSA-OAEP. All credential metadata lives inside the
  ciphertext. The `credentials` table has only `encrypted_data` plus expiry and
  status columns. See `docs/decisions/001-e2ee-architecture.md`.
- Invariant: the server never receives, produces, logs, or returns plaintext
  secrets. Features that need plaintext (generation, strength, breach checks)
  belong in `frontend/src/lib/`, not in `app/`.
- Destructive operations (`DELETE /credentials/{id}`, `PATCH` with
  `encrypted_data`) require an `X-Vault-Proof` header: the client decrypts a
  challenge from `POST /auth/vault/challenge` with the in-memory private key
  (`frontend/src/lib/vaultProof.ts`). A stolen session token alone cannot
  destroy data. Keep new destructive endpoints behind `VaultProvenUser`.
- Not implemented despite older docs: TOTP MFA and WebAuthn/passkeys (both
  `/api/v1/totp/*` and `/api/v1/webauthn/*` return 503), credential sharing,
  emergency access, server-side backup. The `webauthn_credentials` table remains
  for a future verified implementation.
- Current security findings and fix order:
  `docs/research/2026-10-23-security-review-storage-and-auth-surface.md`.

### Entry points and commands

- Backend: `app/main.py` (FastAPI). Run `uvicorn app.main:app --reload` after
  `pip install -e ".[dev]"` and `alembic upgrade head`. Admin CLI: `vault-cli`
  (`app/cli.py`).
- Frontend: `frontend/` (Vite 8 + React 19 + TypeScript 6, Node 22+). `npm install`,
  `npm run dev` (port 3000, proxies `/api` to 8000), `npm run build`.
- Tests: `pytest` at the root (210 tests, coverage configured in `pyproject.toml`);
  `cd frontend && npm run test:run`.
- Lint/type: `ruff check . && ruff format --check .`, `mypy app/`,
  `cd frontend && npm run lint`.
- Deployment: `docker-compose.yaml` (tailscale sidecar, backend, frontend/nginx),
  deployed with `scripts/windows/Deploy-CredentialVault.ps1` (build, pre-deploy
  backup, `up -d`, health and tailnet checks; `-Backup`, `-Restore`, `-Rollback`,
  `-Status`, `-Stop`). The database is the `credential-vault_vault_data` named
  volume, never `./data` (the dev database). Backup/restore run
  `python -m app.maintenance` inside the backend image so other hosts can repeat
  the same `docker compose` steps. The stack on a NAS has not been exercised yet.

### Coding conventions

- Python: type hints on every signature, `async/await` for all I/O, f-strings,
  Pydantic models for request/response schemas, SQLAlchemy models for entities,
  FastAPI dependency injection (`app/api/deps.py`). Ruff line length 100.
- TypeScript: strict mode, `@/` alias for `frontend/src`, hooks in
  `frontend/src/hooks/`, API clients in `frontend/src/services/`, Vitest tests in
  `frontend/src/__tests__/`. Tailwind 4 with CSS-first configuration: the theme
  and the `btn`/`input`/`card` utilities live in `frontend/src/index.css`.
- ESLint 10 with eslint-plugin-react-hooks 7 (React Compiler rules) is an
  error-free gate: do not call setState synchronously inside effects. Derive
  state, use a `key` to remount, or move async work into react-query hooks.
  Decrypted plaintext belongs in queries with `gcTime: 0` so it disappears
  when no longer observed.
- Every credential query must be scoped by `owner_id`; admin endpoints return
  user metadata and counts only.

## Workflows

- Features: consult requirements and architecture; use existing SPEC/PLAN templates
  for complex approved work. Implement, add tests, and update affected docs.
- Bugs: reproduce, identify the cause, fix when authorized, and add regression
  coverage. A diagnosis-only request does not authorize implementation.
- Documentation: use `update-docs` if installed. Otherwise map the change to the
  existing document inventory in `docs/README.md`, update targeted sections,
  check links and examples, and report omissions.
- Tests: use `run-tests` if installed; otherwise read `docs/testing.md` and the
  actual manifest/CI commands. Do not infer pytest solely from a Python filename.
- Review: use `review-code` if installed and you did not author the code. Review
  read-only and report actionable findings with evidence.
- Scripts: use `docs/SCRIPT-STANDARDS.md` for help and naming examples.
- Research: record dated primary sources in `docs/research/` when conclusions
  depend on changing external APIs or protocols.

## Optional Protocol Integrations

A coding-agent skill is not an A2A Agent Card skill, and local agent instructions
are not wire protocol configuration. Consult `docs/terminology.md` first.

When A2A examples are installed, read `docs/a2a/README.md`. Select public versus
authenticated cards deliberately; advertise only implemented capabilities. Validate
the selected protocol revision and actual transport/auth behavior separately.
MCP host configurations belong to that host, not to A2A discovery metadata.

## Services and Ports

Consult `docs/services.md` before assigning a port. If the bootstrap checkout and
its `docs/port-registry.md` are available, check cross-project usage as well.
Choose a configurable port, warn about conflicts, update this project's service
documentation, and obtain permission before changing an external central registry.

## Branch Maintenance

Remote deletion after a squash merge does not remove local branches; ancestry alone
may not identify squash-merged work. Use the shipped merged-branch cleanup helper
only when cleanup is requested:

```powershell
.\scripts\windows\Remove-MergedBranches.ps1 -WhatIf
```

```bash
./scripts/linux/remove-merged-branches.sh --dry-run
```

The macOS copy provides the same interface. Helpers stop on dirty worktrees, skip
other worktrees and never remove the default branch or never-pushed branches.
Read their help before execution. `-ReturnToDefault` / `--return-to-default`
also switches to and fast-forwards the default branch, but only leaves a branch
whose upstream is gone: on an unmerged branch or a detached HEAD it stays and
warns, and a failed fast-forward is reported as a warning. Do not change global
Git settings as an implicit step; use repository-scoped or explicit user choices.

## Handoff

Report the affected behavior, commands actually tested, independent-review status,
documentation updates, and any remaining blockers. Update progress/status only
within the role ownership rules in `AGENTS.md`. Never label placeholder tests or
unrun deployment/runtime checks as passing.
