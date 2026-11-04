# Documentation Index

> This directory contains all project documentation.

## Root-Level Documents

These important documents live in the project root:

| Document | Status | Description |
|----------|--------|-------------|
| [QUICKSTART.zh-TW.md](../QUICKSTART.zh-TW.md) | Complete | 快速開始指南（繁體中文） |
| [PROGRESS.md](../PROGRESS.md) | Complete | Implementation status and work packages |
| [ROADMAP.md](../ROADMAP.md) | Complete | Project roadmap and milestones |

## Core Documents

| Document | Status | Description |
|----------|--------|-------------|
| [requirements.md](./requirements.md) | Template | Requirements specification |
| [architecture.md](./architecture.md) | Template | System architecture |
| [api.md](./api.md) | Template | API specification (REST/WebSocket) |

## Development Guides

| Document | Status | Description |
|----------|--------|-------------|
| [setup-guide.md](./setup-guide.md) | Complete | Environment setup |
| [testing.md](./testing.md) | Complete | Testing strategy |
| [deployment.md](./deployment.md) | Template | Deployment instructions |
| [security-guidelines.md](./security-guidelines.md) | Draft | Security policies |
| [mcp-config.md](./mcp-config.md) | Bootstrap | MCP server configuration |
| [services.md](./services.md) | Complete | Service registry and port assignments |
| [SCRIPT-STANDARDS.md](./SCRIPT-STANDARDS.md) | Bootstrap | Script standards and naming |

## Current Design Proposals

The following documents describe proposed behavior and have not been implemented.

| Document | Status | Description |
|----------|--------|-------------|
| [ADR-003](./decisions/003-structured-credentials-and-attachments.md) | Proposed | 結構化憑證、集合、紀錄關聯與端到端加密附件的架構取捨 |
| [ADR-004](./decisions/004-vault-authenticity-and-key-trust.md) | Proposed | 金鑰信任、簽章、proof 及 padding；格式定案前置條件 |
| [SPEC-004](./specs/SPEC-004-structured-credentials-and-attachments.md) | Draft; gate closed | 型別化欄位、來源簽章、安全保存、完整備份與 36 項驗收條件 |
| [PLAN-004](./plans/PLAN-004-structured-credentials-and-attachments.md) | Draft; gate closed | Phase 0 前置修補與八個後續階段、16 項審閱處置及部署計畫 |

## Scripts

The `scripts/` directory contains platform-specific scripts for your project:

| Directory | Platform | Purpose |
|-----------|----------|---------|
| `scripts/windows/` | Windows | PowerShell scripts (.ps1) |
| `scripts/linux/` | Linux | Bash scripts (.sh) |
| `scripts/macos/` | macOS | Bash scripts (.sh) |

Add your project-specific automation scripts here.

## Agent Guidance and Protocol Examples

| Document | Status | Description |
|----------|--------|-------------|
| [AGENT-GUIDE.md](./AGENT-GUIDE.md) | Complete | Agent collaboration guide with project context |
| [terminology.md](./terminology.md) | Bootstrap | AAIF/A2A/MCP terminology |
| [a2a/](./a2a/) | Optional | A2A 1.0 example set; this project does not implement A2A |
| [specs/](./specs/) | Directory | Feature specifications |
| [plans/](./plans/) | Directory | Implementation plans |
| [decisions/](./decisions/) | Directory | Architecture Decision Records |

**Legend**:

- Complete - project-specific content is written
- Draft - partially written; needs review
- Template - placeholder content; needs project details
- Bootstrap - generic guidance supplied by the bootstrap; usable as-is
- Directory - container for individual records
- Optional - requires an additional flavor

## Research

| Document | Status | Description |
|----------|--------|-------------|
| [research/](./research/) | Directory | Research notes and external sources |
| [2026-11-05 結構化憑證與加密附件](./research/2026-11-05-structured-vault-use-cases.md) | Complete | 六種開發者／雲端情境的一手來源、現況證據及設計推論；尚未實作 |
| [2026-10-23 儲存與認證面安全審查](./research/2026-10-23-security-review-storage-and-auth-surface.md) | Complete | 全專案安全掃描：E2EE 儲存結論、弱點清單與修復順序 |

## Context-Driven Development

For complex features, use the spec-plan-implement workflow:

1. **Spec** (`specs/SPEC-NNN-title.md`): Define what to build and why
2. **Plan** (`plans/PLAN-NNN-title.md`): Define how to build it
3. **Implement**: Follow the plan, update progress

This ensures AI agents understand requirements before writing code.

## For AI Agents

When working on this project:

1. Check this index to understand what documentation exists
2. Create missing documents as needed
3. Update this index when adding new documents
4. Follow templates provided in each file

## Document Standards

- Use Markdown format
- Include a clear title and purpose at the top
- Keep documents focused and concise
- Update the "Last updated" date when modifying

*Last updated: 2026-11-05*
