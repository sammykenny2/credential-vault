# 快速開始指南

> 本指南將協助您在本地或 Docker 環境中運行 Credential Vault。

## 目錄

- [系統需求](#系統需求)
- [本地開發環境](#本地開發環境)
  - [後端設定](#後端設定)
  - [前端設定](#前端設定)
- [Docker 部署](#docker-部署)
- [環境變數設定](#環境變數設定)
- [資料庫遷移](#資料庫遷移)
- [驗證安裝](#驗證安裝)
- [常見問題](#常見問題)

---

## 系統需求

### 本地開發

| 軟體 | 最低版本 | 用途 |
|------|----------|------|
| Python | 3.11+ | 後端執行環境 |
| Node.js | 18+ | 前端建置工具 |
| Git | 2.0+ | 版本控制 |

### Docker 部署

| 軟體 | 最低版本 |
|------|----------|
| Docker | 20.10+ |
| Docker Compose | 2.0+ |

---

## 本地開發環境

### 1. 複製專案

```bash
git clone https://github.com/username/credential-vault.git
cd credential-vault
```

### 2. 設定環境變數

```bash
# 複製範本
cp .env.example .env

# 編輯 .env 檔案，設定必要的值
# 重要：請使用強密碼和隨機金鑰！
```

詳細的環境變數說明請參考[環境變數設定](#環境變數設定)章節。

### 後端設定

#### 建立 Python 虛擬環境

```bash
# 建立虛擬環境
python -m venv .venv

# 啟用虛擬環境 (Windows PowerShell)
.venv\Scripts\Activate.ps1

# 啟用虛擬環境 (Windows CMD)
.venv\Scripts\activate.bat

# 啟用虛擬環境 (Linux / macOS)
source .venv/bin/activate
```

#### 安裝依賴套件

```bash
# 安裝專案（含開發依賴）
pip install -e ".[dev]"
```

#### 初始化資料庫

專案使用 SQLite，無需額外安裝資料庫。資料庫檔案會自動建立在 `data/` 目錄。

#### 執行資料庫遷移

```bash
alembic upgrade head
```

#### 啟動後端服務

```bash
# 開發模式（支援熱重載）
uvicorn app.main:app --reload --port 8000

# 或使用專案腳本
python -m app.main
```

後端 API 將在 http://localhost:8000 運行。

開發模式下可存取：
- API 文件：http://localhost:8000/docs
- ReDoc：http://localhost:8000/redoc
- 健康檢查：http://localhost:8000/health

### 前端設定

```bash
# 進入前端目錄
cd frontend

# 安裝依賴
npm install

# 啟動開發伺服器
npm run dev
```

前端將在 http://localhost:5173 運行。

#### 其他前端指令

```bash
# 建置生產版本
npm run build

# 預覽生產版本
npm run preview

# 執行測試
npm test

# 程式碼檢查
npm run lint
```

---

## Docker 部署

Docker 部署適用於 NAS 或伺服器環境，整合 Tailscale 實現零信任存取。

### 1. 準備設定檔

```bash
# 複製正式環境變數範本（與本機開發用的 .env 分開）
cp .env.production.example .env.production

# 編輯 .env.production，確保以下值已正確設定：
# - SECRET_KEY（使用 openssl rand -hex 32 產生；用預設值或少於 32 字元後端會拒絕啟動）
# - GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET
# - TS_AUTHKEY（Tailscale 認證金鑰）
# - TS_CERT_DOMAIN（你的 tailnet HTTPS 網域）
```

### 2. 取得 Tailscale 認證金鑰

1. 前往 [Tailscale Admin Console](https://login.tailscale.com/admin/settings/keys)
2. 點選「Generate auth key」
3. 設定：
   - Reusable: Yes
   - Ephemeral: No
4. 複製產生的金鑰到 `.env.production` 的 `TS_AUTHKEY`

### 3. 建立 Tailscale 設定（選用）

```bash
# 建立設定目錄
mkdir -p config/tailscale

# 建立 serve.json（可選，用於 HTTPS）
cat > config/tailscale/serve.json << 'EOF'
{
  "TCP": {
    "443": {
      "HTTPS": true
    }
  },
  "Web": {
    "credential-vault.your-tailnet.ts.net:443": {
      "Handlers": {
        "/": {
          "Proxy": "http://frontend:80"
        },
        "/api/": {
          "Proxy": "http://backend:8000"
        }
      }
    }
  }
}
EOF
```

### 4. 啟動服務

```bash
# 建置並啟動所有服務（--env-file 同時提供 compose 插值與後端的環境變數）
docker compose --env-file .env.production up -d

# 查看服務狀態
docker compose --env-file .env.production ps

# 查看日誌
docker compose --env-file .env.production logs -f
```

### 5. 驗證部署

```bash
# 檢查 Tailscale 連線狀態
docker-compose exec tailscale tailscale status

# 檢查後端健康狀態
docker-compose exec backend curl http://localhost:8000/health
```

### 停止服務

```bash
# 停止所有服務
docker-compose down

# 停止並移除資料（注意：會刪除所有資料！）
docker-compose down -v
```

---

## 環境變數設定

### 必要設定

| 變數 | 說明 | 範例 |
|------|------|------|
| `SECRET_KEY` | JWT 簽章金鑰（至少 32 字元；`APP_ENV=production` 時使用預設值會拒絕啟動） | `openssl rand -hex 32` |

憑證加密完全在瀏覽器端完成（E2EE），伺服器沒有加密金鑰可設定。

### 應用程式設定

| 變數 | 預設值 | 說明 |
|------|--------|------|
| `APP_ENV` | `development` | 環境：`development` / `production`（docker-compose 固定為 `production`） |
| `APP_DEBUG` | `true` | 除錯模式（`production` 必須為 `false`） |

### 資料庫設定

| 變數 | 預設值 | 說明 |
|------|--------|------|
| `DATABASE_URL` | `sqlite+aiosqlite:///data/credential_vault.db` | 資料庫連線 URL（預設使用 SQLite，免設定） |

### Session 設定

| 變數 | 預設值 | 說明 |
|------|--------|------|
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `15` | Access Token 有效期（分鐘） |
| `REFRESH_TOKEN_EXPIRE_DAYS` | `7` | Refresh Token 有效期（天） |

### Tailscale 設定（生產環境）

| 變數 | 說明 |
|------|------|
| `TS_AUTHKEY` | Tailscale 認證金鑰 |
| `TS_HOSTNAME` | Tailscale 主機名稱 |
| `TS_CERT_DOMAIN` | HTTPS 憑證網域 |
| `REQUIRE_TAILSCALE` | 是否要求 Tailscale 存取 |

### 初始管理員（選用）

| 變數 | 說明 |
|------|------|
| `ADMIN_EMAIL` | 初始管理員 Email |
| `ADMIN_PASSWORD` | 初始管理員密碼 |
| `ADMIN_DISPLAY_NAME` | 管理員顯示名稱 |

---

## 資料庫遷移

專案使用 Alembic 管理資料庫遷移。

### 執行遷移

```bash
# 升級到最新版本
alembic upgrade head

# 查看目前版本
alembic current

# 查看遷移歷史
alembic history
```

### 建立新遷移

```bash
# 自動產生遷移（根據模型變更）
alembic revision --autogenerate -m "描述變更內容"

# 手動建立空遷移
alembic revision -m "描述變更內容"
```

### 回滾遷移

```bash
# 回滾一個版本
alembic downgrade -1

# 回滾到特定版本
alembic downgrade <revision_id>
```

---

## 驗證安裝

### 執行測試

```bash
# 後端測試
pytest

# 含覆蓋率報告
pytest --cov=src --cov-report=html

# 前端測試
cd frontend && npm test
```

### 健康檢查

```bash
# 後端健康檢查
curl http://localhost:8000/health

# 預期回應
# {"status": "healthy", "version": "0.1.0"}
```

---

## 常見問題

### Q: 無法連線到資料庫

**A:** 確認以下事項：
1. `data/` 目錄存在且有寫入權限
2. `.env` 中的 `DATABASE_URL` 路徑正確
3. 已執行 `alembic upgrade head` 初始化資料庫

### Q: 前端無法連線到後端 API

**A:** 確認：
1. 後端服務已啟動（http://localhost:8000/health）
2. CORS 設定正確（開發模式預設允許所有來源）
3. 前端的 API URL 設定正確

### Q: Docker 建置失敗

**A:** 嘗試以下步驟：
```bash
# 清除快取重新建置
docker-compose build --no-cache

# 檢查磁碟空間
docker system df

# 清理未使用的 Docker 資源
docker system prune
```

### Q: Tailscale 無法連線

**A:** 確認：
1. `TS_AUTHKEY` 有效且未過期
2. Auth key 設定為 Reusable
3. Tailscale 容器有足夠權限（NET_ADMIN, SYS_MODULE）

### Q: 如何重設管理員密碼？

**A:** 使用 CLI 工具：
```bash
vault-cli reset-password --email admin@example.com
```

---

## 下一步

- 閱讀 [架構文件](./docs/architecture.md) 了解系統設計
- 查看 [API 文件](./docs/api.md) 了解 API 端點
- 參考 [部署指南](./docs/deployment.md) 進行生產部署
- 閱讀 [安全指南](./docs/security-guidelines.md) 了解安全最佳實踐

---

*最後更新：2026-03-15*
