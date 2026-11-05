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
- Key trust: unlock derives the RSA public key from the KEK-protected private
  material, rejects a mismatched API key, and retains only the derived public
  key. A mismatch is a security event, reported separately from a wrong password.
- Record signatures: the KEK-protected key bundle (`users.encrypted_private_key`)
  also holds an ECDSA P-256 key. It signs the ciphertext hash, revision and status
  of every record (`frontend/src/lib/recordSigning.ts`, ADR-004). Browsers verify
  with the key from the bundle before decrypting: an unsigned or altered record
  is refused and reported, never hidden. A new state derived from a stored record
  must be signed from the row the user reviewed, verified first, with no fresh GET
  (`credentialService.writeNextState`). A verified row only proves a state was
  signed, not that it is the record asked for, so a server answering a new GET
  could get another record signed. The server treats record signatures as opaque.
- An RSA-only vault must finish a one-time upgrade before it unlocks, which signs
  its records as `legacy-unverified`. There is no unlocked state without a signer.
- Invariant: the server never receives, produces, logs, or returns plaintext
  secrets. Features that need plaintext (generation, strength, breach checks)
  belong in `frontend/src/lib/`, not in `app/`.
- Every credential write (`VaultSigningUser`) and `DELETE /credentials/{id}`
  (`VaultProvenUser`) require an `X-Vault-Proof` header: the client signs a nonce
  from `POST /auth/vault/challenge` with the in-memory signing key
  (`frontend/src/lib/vaultProof.ts`). The nonce is stateless, so issuing one never
  invalidates another. A stolen session token alone cannot change data. Proof v1
  (RSA with the OAEP label `credential-vault/vault-proof/v1`, also stateless) only
  authorizes `POST /auth/vault/upgrade`; never add a proof that returns an RSA
  decryption for a signed vault.
  `POST /auth/vault/setup` also needs a ten-minute `X-Vault-Setup` authorization
  issued only after interactive login, bound to the user, token_version and login
  family. Refresh never issues one. A token-only client cannot install new keys.
  Keep new destructive endpoints behind `VaultProvenUser`.
  Changes that would let a stolen token keep access need it too: adding a
  sign-in password (`PUT /users/me/password`) and every admin change to
  accounts (create, update, role, reactivate, delete) use `VaultProvenAdmin`,
  so an admin manages users only with the vault unlocked.
- Session/operation boundaries: ADR-005 and SPEC-005. Refresh families are stored
  and rotated with CAS and absolute expiry; logout commits revocation before success.
  Every asynchronous plaintext operation captures account and unlock generations,
  and checks them before later side effects. Closing/unmounting cancels dialog work.
  Never replace these checks with reading the current global keys after an await.
- Backups fetch/verify every page including revoked rows, then compare the snapshot
  again. The new text-only JSON type is `credential-record-backup` v1, distinct
  from both legacy `credential-backup` v1 and planned ZIP v2. Restore preserves
  revocation but labels origin unverified; completed batches can remain on failure.
- FastAPI 0.162 uses included-router objects that stock SlowAPI middleware misses.
  `RequestLimitMiddleware` enforces the shared API budget before reading bodies,
  using SlowAPI's public backend. Test real HTTP 429s, not just decorator presence.
- Database dependencies use `scope="function"` so their commit precedes response
  delivery. Security-sensitive commit endpoints also commit explicitly. Do not
  move commits back to request teardown or claim success after a commit failure.
- Not implemented despite older docs: TOTP MFA and WebAuthn/passkeys (both
  `/api/v1/totp/*` and `/api/v1/webauthn/*` return 503), credential sharing,
  emergency access, server-side backup. The `webauthn_credentials` table remains
  for a future verified implementation.
- Current security findings and fix order:
  `docs/research/2026-10-23-security-review-storage-and-auth-surface.md`.

### Entry points and commands

- Backend: `app/main.py` (FastAPI). Run `uvicorn app.main:app --reload` after
  `uv sync --extra dev` and `alembic upgrade head`. Admin CLI: `vault-cli`
  (`app/cli.py`).
- Python dependencies are locked in `uv.lock` (universal, hashed). After editing
  `pyproject.toml` run `uv lock` with uv 0.12.24 (`uvx --from uv==0.12.24 uv lock`,
  the version CI and the Dockerfile pin); CI fails on a stale lock. CI and the
  backend image install `uv export --frozen` output with `pip --require-hashes`.
- Frontend: `frontend/` (Vite 8 + React 19 + TypeScript 6, Node 24+). `npm install`,
  `npm run dev` (port 3000, proxies `/api` to 8000), `npm run build`.
- Tests: `pytest` at the root (coverage configured in `pyproject.toml`);
  `cd frontend && npm run test:run`.
- Lint/type: `ruff check . && ruff format --check .`, `mypy app/`,
  `cd frontend && npm run lint`.
- Deployment: `docker-compose.yaml` (tailscale sidecar, backend, frontend/nginx),
  deployed with `scripts/windows/Deploy-CredentialVault.ps1`: by default the latest
  CI release (a push to main that changes `VERSION` is a release, run as three
  least-privilege jobs: `publish` pushes `:<sha>` to GHCR and attests build
  provenance, `scan` runs grype and fails on fixable High/Critical findings,
  `release` re-puts the scanned manifest as `:<VERSION>`/`:latest`, records digests as
  `release/backend` / `release/frontend` commit statuses and creates the `v<VERSION>`
  GitHub release with commit-subject notes; the script pulls by digest, checks the
  revision and version labels and runs `gh attestation verify`), or `-Build` from the checkout; then
  pre-deploy backup, `up -d`, health and tailnet checks, and a check of the
  served `Cache-Control`/CSP headers on `/` and `/sw.js`. Also `-Tag <version|sha>`,
  `-Backup`, `-Restore`, `-Rollback`, `-Status`, `-Stop`. Keep the publish job's
  `provenance: false` / `sbom: false`: attestation manifests would be counted
  and deleted by the keep-5 retention step. The database is the `credential-vault_vault_data` named
  volume, never `./data` (the dev database). Backup/restore run
  `python -m app.maintenance` inside the backend image so other hosts can repeat
  the same `docker compose` steps. The stack on a NAS has not been exercised yet.
- Version: `VERSION` (x.y.z) is the only copy. pyproject reads it
  (`[tool.setuptools.dynamic]`), `app/config.py` reads it at runtime (`/health`
  returns `version` and `revision`), and the frontend bakes `__APP_VERSION__` /
  `__APP_REVISION__` in `vite.config.ts` (build args in the image). The sidebar
  (`VersionInfo`) shows the bundle's build and a reload hint when `/health`
  reports another.
- CI hygiene: every action is pinned to a full commit SHA with the version in a
  comment; base images and the Tailscale sidecar are pinned `tag@digest`;
  Dependabot (`.github/dependabot.yml`, two-week cooldown) proposes updates for
  actions, `uv.lock`, npm, Dockerfiles and compose. `ci.yaml` skips docs-only
  changes (`docs/**`, `**/*.md`); `docker-check.yaml` builds both images when a
  Dockerfile, dependency file, nginx config or compose changes.

### Coding conventions

- Python: type hints on every signature, `async/await` for all I/O, f-strings,
  Pydantic models for request/response schemas, SQLAlchemy models for entities,
  FastAPI dependency injection (`app/api/deps.py`). Ruff line length 100.
- TypeScript: strict mode, `@/` alias for `frontend/src`, hooks in
  `frontend/src/hooks/`, API clients in `frontend/src/services/`, Vitest tests in
  `frontend/src/__tests__/`. Tailwind 4 with CSS-first configuration: the theme
  and the `btn`/`input`/`card` utilities live in `frontend/src/index.css`.
- Every text `<input>` / `<textarea>` declares how browsers may treat it:
  spread `secretFieldProps` (credential values, notes, vault and backup
  passwords) or `privateFieldProps` (other private text) from
  `frontend/src/lib/inputProps.ts`, or set a standard `autoComplete` token on
  account fields (`username`, `new-password`, `current-password`).
  `inputProps.test.tsx` scans the sources and fails on an undeclared field.
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
