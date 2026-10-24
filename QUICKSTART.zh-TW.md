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
| Python | 3.14+ | 後端執行環境 |
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
# 安裝專案（含開發依賴），版本與 CI、正式環境的 image 相同（取自 uv.lock）
uv sync --extra dev

# 沒有 uv 時也可以（版本不鎖定）
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

正式環境一律跑 Docker（`docker-compose.yaml`：Tailscale sidecar、後端、前端 nginx），不要拿 `npm run dev` / `uvicorn --reload` 當常駐服務。三個容器都設了 `restart: unless-stopped`，部署一次之後，Docker 一啟動它們就會自己回來，重開機不用再手動執行任何東西。

同一份 compose 檔可以跑在 Docker Desktop for Windows、NAS 或其他 Docker 主機上：

- 資料庫放在 named volume `credential-vault_vault_data`，不是 `./data`（那是開發用資料庫）。這也避開了 Windows 掛載 NTFS 時 SQLite 鎖定不可靠、以及 NAS 上主機資料夾權限不符（容器以 uid 1000 執行）的問題。
- 映像檔名稱固定為 `credential-vault-backend:local` / `credential-vault-frontend:local`，可用 `docker save` / `docker load` 搬到別台主機，不必在那台重新 build。
- 備份與還原由後端映像檔內的 `python -m app.maintenance` 執行，任何主機做法都一樣。
- Tailnet 上的機器名稱由 `TS_HOSTNAME` 決定，第二台主機要用不同名稱。

### 1. 準備設定檔

```powershell
# 複製正式環境變數範本（與本機開發用的 .env 分開，兩者都不進 git）
Copy-Item .env.production.example .env.production
```

編輯 `.env.production`：

- `SECRET_KEY`：`openssl rand -hex 32` 產生；用預設值或少於 32 字元後端會拒絕啟動
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`：Google Console 的 web client 要加上重新導向 URI `https://<TS_CERT_DOMAIN>/login`
- `TS_AUTHKEY`：可留空，見下一步
- `TS_HOSTNAME` / `TS_CERT_DOMAIN`：例如 `credential-vault` / `credential-vault.<tailnet>.ts.net`

### 2. 取得 Tailscale 認證金鑰

`TS_AUTHKEY` 可以留空：部署腳本會印出 Tailscale 的登入網址，在瀏覽器打開核准即可，金鑰不必寫進任何檔案。要用 auth key 的話：

1. 前往 [Tailscale Admin Console](https://login.tailscale.com/admin/settings/keys)，點「Generate auth key」
2. Reusable 不需要（節點身分存在 `tailscale_state` volume，之後重啟不用再認證）；Ephemeral 選 No
3. 填入 `.env.production` 的 `TS_AUTHKEY`，第一次部署成功後清空

不論哪種方式：

- tailnet 需開啟 MagicDNS 與 HTTPS Certificates（Admin Console → DNS）
- 若 Machines 清單已有同名的舊機器，先刪掉，否則新節點會變成 `credential-vault-1`，網址和 Google 重新導向 URI 都會對不上
- 加入後到 Machines 頁對這台機器選 Disable key expiry，否則約 180 天後節點金鑰過期、服務會離開 tailnet

### 管理員帳號

`.env.production` 不必放任何管理員資料。還沒有管理員時，登入頁會提示，兩種方式擇一：

- 直接用 Google 登入：第一個登入的 Google 帳號就是管理員。之後可在設定頁的「Sign in with Password」補上密碼（需先解鎖 vault），就能在 `/admin/login` 用 email 加密碼登入。
- 點登入頁上的連結到 `/admin/setup`，輸入 email 與密碼建立管理員（伺服器只存 bcrypt 雜湊），之後用同一個 email 的 Google 帳號登入會自動綁定。

兩種方式最後的帳號狀態相同：Google 與 email 加密碼都能登入。管理使用者（Users 頁的升降級、停用、重新啟用）也需要先解鎖 vault，只偷到登入 token 的人無法變更帳號。Credentials 頁右上角 Backup 旁的 Lock 可隨時手動鎖定。部署完請立刻完成這一步：在管理員建立之前，tailnet 上任何人打開網站都能搶先成為管理員。設了 `ADMIN_EMAIL` 時，只有那個 Google 帳號能成為第一位管理員；`ADMIN_EMAIL` 加 `ADMIN_PASSWORD` 則在啟動時直接建立管理員。

`config/tailscale/serve.json` 已在 repo 中，`${TS_CERT_DOMAIN}` 由 Tailscale 容器在執行時自動代入，不需要修改。

### 3. 部署（Windows）

映像檔有兩種來源：

- **CI release（預設）**：版號只寫在 repo 根目錄的 `VERSION`（`x.y.z`）。平常的 push 和 PR 只跑測試（只改 `docs/` 或 Markdown 的連測試都不跑）；改到 Dockerfile、依賴檔、nginx 設定或 compose 時，另外試 build 映像檔（`docker-check.yaml`，不推送）。只有 push 到 main 且 `VERSION` 是還沒發布過的版號時才發版，分三步：
  - `publish`：build 兩個映像檔，只以 commit SHA 為標籤推到 GHCR（`ghcr.io/<owner>/credential-vault-{backend,frontend}`），並簽署 build provenance（GitHub artifact attestation，證明映像檔是這個 repo 的 CI 從這個 commit build 的）。
  - `scan`：用 grype 掃描兩個映像檔，有「已有修補版本」的 High 或 Critical 漏洞就停止發版。這一步沒有任何寫入權限。
  - `release`：掃描通過後才把同一份映像檔加上版號與 `latest` 標籤、把 digest 記成該 commit 的 `release/backend`、`release/frontend` status、建立 GitHub release `v<版號>`（說明列出上一版以來的 commit），只保留最新 5 版。
  - 部署腳本透過 GitHub API 讀 status、以 digest 拉映像檔，確認標籤上的 commit 與版號相符，並用 `gh attestation verify` 驗證簽章；只拿到 GHCR 憑證、或能寫 commit status 的人都無法換掉要部署的映像檔。
  - 發布新版：改 `VERSION`（例如 `0.3.1` → `0.3.2`）、commit、push 到 main。CI 會擋下格式不對或比最新 release 還小的版號。版號不變的 push 不產生映像檔。
  - 發布失敗時不會建立 tag，修好後用同一個版號再 push 一次即可。
  - 不帶參數部署的是最新的 GitHub release。`-Tag 0.3.1` 部署指定版本，只有最新 5 版可選。v0.3.0 早於簽章機制，不能再用 `-Tag` 部署，要回去請用 `-Rollback` 或 `-Build`。
  - 介面左下角顯示正在用的版號與 commit（例如 `v0.3.1 · 1a2b3c4`）。瀏覽器還在用舊版介面時，下方會提示伺服器的版本，點一下重新整理即可。
  - 依賴更新：Dependabot 每週對 GitHub Actions、Python（`uv.lock`）、npm、base image 與 Tailscale 開 PR，新版本發布滿兩週才會提議。
- **本機 build（`-Build`）**：從目前的 checkout 建置，版號一樣取自 `VERSION`。CI 不能跑的時候用這個。

CI release 模式的一次性準備：

- `gh auth login`（GitHub CLI，用來查 release）
- repo 與映像檔都是 public，拉映像檔不用登入。只有把 GHCR package 改成 private 時，才需要 `docker login ghcr.io -u <GitHub 帳號>`，密碼用一把只有 `read:packages` 權限的 classic personal access token

```powershell
# 部署最新的 CI release：查 release → 依 digest 拉映像檔並驗證 → 停後端 → 備份 → 啟動 → 健康檢查
.\scripts\windows\Deploy-CredentialVault.ps1

# 部署指定版本的 CI release（也接受該 release 的 commit SHA）
.\scripts\windows\Deploy-CredentialVault.ps1 -Tag 0.3.0

# 從目前的 checkout 建置並部署
.\scripts\windows\Deploy-CredentialVault.ps1 -Build
```

其他動作：

```powershell
.\scripts\windows\Deploy-CredentialVault.ps1 -Status    # 容器健康與執行中的版號與 commit、tailnet 網址、最近的備份
.\scripts\windows\Deploy-CredentialVault.ps1 -Backup    # 備份到 backups\backup-<時間>.db
.\scripts\windows\Deploy-CredentialVault.ps1 -Restore .\backups\<檔名>.db  # 以備份取代資料庫（會先備份現況）
.\scripts\windows\Deploy-CredentialVault.ps1 -Rollback  # 回到上一次部署前的映像檔與資料庫
.\scripts\windows\Deploy-CredentialVault.ps1 -Stop      # 停止服務，直到下次部署前重開機也不會自己起來
```

`backups\` 不進 git。備份內容是密文與包裝過的金鑰，仍建議另外複製一份到別的磁碟。

Docker Desktop 必須在登入 Windows 時自動啟動（設定 → General → Start Docker Desktop when you sign in，或在「啟動」資料夾放捷徑）。Docker Desktop 要等使用者登入才會啟動；需要「開機即上線、不必登入」的話，改放 NAS。

### 4. 其他 Docker 主機（NAS 等）

腳本的每個步驟都是 `docker compose` 指令，在沒有 PowerShell 的主機上可以照順序手動執行：

```bash
# 版號與 commit 會顯示在介面上
export VAULT_VERSION="$(cat VERSION)" VAULT_REVISION="$(git rev-parse HEAD)"
docker compose --env-file .env.production build --pull
docker compose --env-file .env.production stop backend
docker compose --env-file .env.production run --rm --no-deps -T \
  -v "$PWD/backups:/backups" backend python -m app.maintenance backup /backups/pre-deploy.db
docker compose --env-file .env.production up -d
```

改用 CI release 時，把前兩行換成：從 GitHub release `v<版號>` 所在 commit 的 `release/*` status 取得 digest，`docker pull ghcr.io/<owner>/credential-vault-backend@<digest>`（frontend 同理），確認 `org.opencontainers.image.revision` 標籤等於該 commit，再 `docker tag` 成 `credential-vault-backend:local` / `credential-vault-frontend:local`。

還原：`docker compose --env-file .env.production run --rm --no-deps -T --user root -v "<資料夾>:/restore:ro" backend python -m app.maintenance restore /restore/<檔名>`。

注意事項：ARM 的 NAS 需另外 build `linux/arm64` 映像檔；部分 Synology kernel 不支援 compose 裡的 `cpus:` 限制，遇到錯誤時拿掉該行即可；`backups` 資料夾要讓 uid 1000 可寫入。

### 5. 驗證部署

```bash
# Tailscale 是否已加入 tailnet、取得的網址
docker compose --env-file .env.production exec tailscale tailscale status

# 從同一個 tailnet 上的電腦
curl https://<TS_CERT_DOMAIN>/health
```

### 停止服務

```bash
# 停止所有服務（資料保留）
docker compose --env-file .env.production down

# 千萬不要加 -v：會連同 credential-vault_vault_data 一起刪掉，也就是整個保險庫
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
| `TRUSTED_PROXIES` | 信任其 `X-Forwarded-For` 的反向代理網段（預設 loopback 與 Docker bridge `172.16.0.0/12`）；只有從這些網段進來的連線才會採用轉送鏈中的來源位址 |

### 初始管理員（選用）

| 變數 | 說明 |
|------|------|
| `ADMIN_EMAIL` | 只有這個 Google 帳號能成為第一位管理員（不設則第一個登入的 Google 帳號成為管理員） |
| `ADMIN_PASSWORD` | 與 `ADMIN_EMAIL` 一起設定時，啟動即建立該管理員並設此密碼 |
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
