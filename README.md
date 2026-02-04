# Credential Vault

> 安全的個人/團隊憑證管理系統，運行於內網環境，透過 Tailscale 存取。

## Overview

Credential Vault 是一個自託管的憑證管理系統，專為安全性設計：

- **零信任存取**：僅透過 Tailscale VPN 連入，不暴露 Web Port
- **MFA 認證**：連入後需完成多因素認證
- **角色分離**：Admin 管理使用者但無法查看個人憑證
- **個人保險箱**：每位使用者獨立管理自己的 credentials (新增/刪除/撤銷)
- **NAS 部署**：透過 Docker Compose 部署至 NAS

## Current Status

- [ ] 系統架構設計
- [ ] 後端 API 開發
- [ ] 前端 UI 開發
- [ ] MFA 整合
- [ ] Docker 部署設定

## Quick Start

```bash
# Clone the repository
git clone https://github.com/username/credential-vault.git
cd credential-vault

# Setup environment
cp .env.example .env
# Edit .env with your values (IMPORTANT: set strong secrets!)

# Development (local)
python -m venv .venv
.venv\Scripts\activate  # Windows
pip install -e ".[dev]"
uvicorn src.main:app --reload

# Production (Docker)
docker-compose up -d
```

## Documentation

See [docs/](./docs/) for detailed documentation:

- [Setup Guide](./docs/setup-guide.md)
- [Architecture](./docs/architecture.md)
- [Contributing](./CONTRIBUTING.md)

## Project Structure

```
credential-vault/
├── src/
│   ├── api/           # FastAPI routes
│   ├── core/          # Core business logic
│   ├── models/        # Database models
│   ├── services/      # Business services
│   └── main.py        # Application entry point
├── frontend/          # React frontend (TBD)
├── tests/             # Test files
├── docs/              # Documentation
├── scripts/           # Build/deployment scripts
├── config/            # Configuration files
└── docker-compose.yaml
```

## Maintenance

### Updating Agent Rules & Templates

This project follows AAIF standards. You can update the core infrastructure files (Agent rules, documentation templates) using the built-in update scripts:

**Windows**
```powershell
.\scripts\windows\Update-Project.ps1
```

**Linux / macOS**
```bash
./scripts/linux/update-project.sh
```

## License

This project is licensed under the MIT License - see the [LICENSE](./LICENSE) file for details.
