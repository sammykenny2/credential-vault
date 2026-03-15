# Credential Vault

> 安全的個人/團隊憑證管理系統，運行於內網環境，透過 Tailscale 存取。

## Overview

Credential Vault 是一個自託管的憑證管理系統，專為安全性設計：

- **零知識端到端加密 (E2EE)**：憑證在瀏覽器端加密，伺服器無法解密
- **Google OAuth 登入**：透過 Google 帳號驗證身份
- **零信任存取**：僅透過 Tailscale VPN 連入，不暴露 Web Port
- **角色分離**：Admin 管理使用者但無法查看個人憑證
- **個人保險箱**：每位使用者獨立管理自己的 credentials (新增/刪除/撤銷)
- **NAS 部署**：透過 Docker Compose 部署至 NAS

## Current Status

- [x] 系統架構設計
- [x] 後端 API 開發
- [x] 前端 UI 開發
- [x] E2EE 加密架構 (RSA-OAEP + AES-256-GCM 混合加密)
- [x] Google OAuth 2.0 整合
- [ ] Docker 部署設定
- [ ] 完整測試驗證

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
alembic upgrade head
uvicorn app.main:app --reload

# Production (Docker)
docker-compose up -d
```

## Documentation

See [docs/](./docs/) for detailed documentation:

- [快速開始指南 (繁體中文)](./QUICKSTART.zh-TW.md)
- [Setup Guide](./docs/setup-guide.md)
- [Architecture](./docs/architecture.md)
- [Contributing](./CONTRIBUTING.md)

## Project Structure

```
credential-vault/
├── app/
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
├── data/              # SQLite database (auto-created)
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
