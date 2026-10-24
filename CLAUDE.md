# Claude-Specific Instructions

> **If you are NOT Claude, please ignore this file.**

## Prerequisites

**MUST** read `AGENTS.md` first for cross-agent guidelines before reading this file.

## Role Awareness

Check the **Project Roles** table in `AGENTS.md`.
- If a **Conductor** is assigned (and it's not you), act as a Specialist: prioritize their tasks and strictly follow their architectural plans.
- If **you** are the Conductor, you are responsible for orchestration, task management, and status tracking.

## Command Aliases

- `dyu` - **MUST** confirm you have read `AGENTS.md` and this file. **MUST** respond with exactly: "I am Claude, and I understand."
- `mbf` - **Merge Bootstrap Files**:
  1. Find all `*.bootstrap` files in the project
  2. For each `.bootstrap` file, compare with its corresponding file and merge appropriate content (preserve user customizations, incorporate new template additions)
  3. Delete each `.bootstrap` file after successful merge
  4. Find all `.gitkeep` files and check if their parent directory contains other files not ignored by `.gitignore` - if so, delete the `.gitkeep` file
  5. Report summary of changes when complete

## Output Formatting Rules

- **MUST** 使用條列式 (bullet list) 而非表格，除非是模擬圖表或表格真正必要
- **MUST NOT** 濫用表格語法（`|` 和 `-----`）
- **SHOULD** 用縮排條列取代多欄表格
- 例外情況：比較多個選項的優缺點、數據對照表、API 參數規格等真正需要表格的場景

## About This File

This file contains Claude-specific configurations and instructions that should not be applied by other AI agents (Gemini, Codex, etc.).

Only Claude should read and maintain this file.

---

## Claude-Specific Configurations

### Behavioral Guidelines

- **MUST** read AGENTS.md at the start of every session
- **MUST** follow the Development Workflow defined in AGENTS.md
- **MUST NOT** skip testing when code changes are made
- **MUST NOT** modify other agents' files (GEMINI.md, CODEX.md)
- **SHOULD** ask for clarification when requirements are ambiguous
- **SHOULD** propose approach before implementing major changes

### Conductor Responsibilities

If assigned as Conductor in Project Roles table:
- **MUST** maintain README.md "Current Status" section
- **MUST** create and assign tasks in `docs/plans/`
- **MUST** document major decisions in `docs/decisions/`
- **MUST NOT** make unilateral architectural decisions without documentation

### Code Modification Rules

- **MUST** update tests when modifying code
- **MUST** update documentation when changing public APIs
- **MUST** follow coding conventions specified in AGENTS.md
- **SHOULD** make minimal, focused changes
- **SHOULD** commit frequently with clear messages

### Agent Skills

Claude Code discovers skills from `.claude/skills/<name>/SKILL.md`. The canonical source is the `skills/` directory at the project root.

To sync skills after changes:
```powershell
.\scripts\windows\Sync-AgentSkills.ps1
```

### MCP Server Configurations

```json
{
  "mcpServers": {
    // Add Claude-specific MCP server configurations here if needed
  }
}
```

### Preferred Behaviors

- **Precision over speed**: Take time to understand requirements fully
- **Test before commit**: Always validate changes work as expected
- **Document decisions**: Use ADRs for architectural choices
- **Communicate clearly**: Report progress and blockers promptly

### Project-Specific Context

- Zero-knowledge invariant: credential plaintext exists only in the browser. Do not add backend code that receives, generates, logs, or returns plaintext secrets, even for "helper" features such as password generation or strength checks.
- Admin role manages users only; there is no server path that lets an admin read another user's credentials. Keep it that way.
- TOTP MFA and WebAuthn/passkeys are stubbed (`/api/v1/totp/*` and `/api/v1/webauthn/*` return 503). Do not describe either as working protection; a WebAuthn implementation must verify attestation and assertion signatures (for example with `py_webauthn`) before it is wired to anything.
- Open security findings and the recommended fix order are in `docs/research/2026-10-23-security-review-storage-and-auth-surface.md`. Read it before touching auth, crypto, nginx, service worker, or deployment config.
- Verified commands (2026-10-24): `pytest` at the root passes 229 tests; frontend uses `npm run test:run` inside `frontend/` (201 tests).
- Admin account changes (`/users/*` writes) and adding a sign-in password require `X-Vault-Proof` (`VaultProvenAdmin` / `VaultProvenUser`). Do not add an account-changing endpoint behind plain `AdminUser`.
- Production runs only through `scripts/windows/Deploy-CredentialVault.ps1` (Docker, `credential-vault_vault_data` volume). `./data` is the dev database; never point the compose stack at it, and never run `docker compose down -v` (it deletes the vault).

---

## Maintenance

This file is maintained by Claude only. Other agents should not modify this file.

Last updated: 2026-10-23
