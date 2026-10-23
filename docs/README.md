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
