# 儲存與認證面安全審查

- 日期 / 審查基準：2026-10-23，`main` 分支 commit `aa0a353`。
- 使用者請求：很久沒看這個專案，整個掃一次，有沒有明顯弱點，儲存的東西是否真的夠安全。
- 性質：靜態程式碼審查，加上本機工具執行（`pytest`、`pip-audit`、`npm audit`、SQLite schema 檢視、git 歷史掃描）。沒有對執行中的服務做動態測試，沒有 build Docker 映像，沒有碰任何實際憑證資料。
- 相關文件：[ADR-001](../decisions/001-e2ee-architecture.md)、[SPEC-003](../specs/SPEC-003-e2ee-architecture.md)、[security-guidelines.md](../security-guidelines.md)。
- 後續：本文件只記錄發現與建議順序，沒有改任何程式碼。修復時請逐項開 commit，並在文末「處理狀態」更新。

## 結論摘要

加密儲存的本體是紮實的，問題出在加密外圍。資料庫裡的 `credentials` 表只有 `encrypted_data` 一欄，名稱、網址、欄位全部在密文內。拿到 DB 檔的人只能離線猜 vault 密碼。真正會讓「伺服器看不到明文」破功、或讓攻擊者不必破解密碼就能造成傷害的地方有四個：伺服器端產生密碼、前端沒有 CSP 且 token 放 localStorage、WebAuthn 半成品、依賴有已知漏洞而 CI 不會擋。

## 審查範圍與方法

- 讀過的後端：`app/config.py`、`app/main.py`、`app/core/*`、`app/api/deps.py`、`app/api/v1/*`、`app/models/*`、`app/services/*`、`app/db/session.py`、`app/cli.py`、`alembic/`。
- 讀過的前端：`frontend/src/lib/crypto.ts`、`credentialBackup.ts`、`hooks/useVaultKey.ts`、`useCredentialCrypto.ts`、`stores/authStore.ts`、`services/*`、`pages/LoginPage.tsx`、`AdminSetupPage.tsx`、`components/MasterPasswordModal.tsx`、`PasswordGenerator.tsx`、`public/sw.js`、`nginx.conf`、`vite.config.ts`、`index.html`、`main.tsx`。
- 部署：`Dockerfile`、`frontend/Dockerfile`、`docker-compose.yaml`、`config/tailscale/serve.json`、`.env.example`、`.github/workflows/ci.yaml`。
- 工具結果：後端 188 個測試全部通過；`pip-audit` 與 `npm audit --omit=dev` 結果見弱點第 4 項；`git log --all` 沒有 `.env`、`*.db`、私鑰曾被提交的紀錄；`git grep` 沒有真實 secret 字串，命中的只有範本 placeholder。
- 本機 `data/credential_vault.db` 只檢視 schema 與 row count，沒有讀取內容。

## 設計上正確的部分

- 金鑰階層：vault 密碼經 Argon2id（64 MiB、3 iterations、parallelism 1）導出 KEK，KEK 以 AES-256-GCM 包 RSA-2048 私鑰；每筆憑證用隨機 AES-256-GCM 金鑰加密，再以 RSA-OAEP（SHA-256）包該金鑰。IV 皆由 `crypto.getRandomValues` 產生，每筆憑證金鑰不重用，所以 GCM IV 碰撞不是問題。參數高於 OWASP 對 Argon2id 的最低建議。
- 解鎖後匯入的私鑰設為 non-extractable，只存在記憶體，15 分鐘無活動自動上鎖（`useVaultKey.ts`）。
- 伺服器 schema 零知識：`credentials` 只有 `encrypted_data`、`expires_at`、`is_active`、`revoked_at` 與時間戳；`users` 存 `public_key`、`encrypted_private_key`、`key_salt`。
- 權限隔離：所有憑證查詢都以 `owner_id` 過濾（`app/services/credential.py`）；admin 路由只回傳使用者 metadata 與數量，沒有任何能讀別人 `encrypted_data` 的路徑。
- 前端寫入後會獨立重讀驗證（`credentialService.create/update`），更新失敗會回滾。
- `.cvault` 匯出也是客戶端 Argon2id + AES-GCM，伺服器不參與。
- 密碼 hash 用 bcrypt，JWT 解碼固定 `algorithms=[HS256]`，沒有 alg confusion 風險。

## 弱點清單（依嚴重度）

### 高

1. 密碼產生器在伺服器端產生明文。
   - `frontend/src/components/PasswordGenerator.tsx` 呼叫 `toolsService.generatePassword`，後端 `app/api/v1/tools.py` 的 `/tools/generate-password` 與 `/tools/generate-passphrase` 產生密碼後以明文回傳，使用者接著把它存進保險箱。伺服器被入侵時攻擊者可看到每一組新產生的密碼。
   - 伺服器失敗時的前端 fallback 用 `Math.random()`，不是密碼學安全亂數。
   - `/tools/check-strength` 與 `/tools/check-breach` 接收明文密碼。目前 UI 沒有呼叫，但端點與 `toolsService.checkStrength/checkBreach` 仍在。
   - 建議：改用 `frontend/src/lib/crypto.ts` 的 `generatePassword`（已用 `getRandomValues`；可順手修掉 `v % charset.length` 的取模偏差），強度與 HIBP 查詢改在瀏覽器做（HIBP range API 支援 CORS，需放寬 CSP `connect-src`），刪除四個 `/tools` 密碼端點與對應測試。

2. 前端頁面沒有 CSP，而 access/refresh token 放在 localStorage。
   - `app/core/security_headers.py` 的 CSP 只套在 API 回應；HTML 與 JS 由 nginx 送出，`frontend/nginx.conf` 沒有 `Content-Security-Policy`，也沒有 HSTS。
   - `frontend/src/stores/authStore.ts` 用 zustand `persist` 把 `accessToken`、`refreshToken` 寫進 localStorage。refresh token 有效 7 天（`app/core/security.py`），沒有 `jti`、沒有伺服器端撤銷，登出只是前端清掉。
   - 後果：任何 XSS 都能偷 token、攔截輸入中的 vault 密碼、讀取解密後畫面內容。E2EE 擋不住這條路。
   - 建議：nginx 加 CSP（起手式 `default-src 'self'; script-src 'self'; connect-src 'self' https://api.pwnedpasswords.com; frame-ancestors 'none'`）與 HSTS；refresh token 改為 httpOnly cookie，或至少縮短效期並加入撤銷表；access token 可留在記憶體。

3. WebAuthn 是半成品，但設定頁已讓使用者註冊 Passkey。
   - `app/services/webauthn_service.py` 的 `register_credential` 不驗證 attestation object 與 clientDataJSON 的 challenge/origin，任意 `credential_id` 與 `public_key` 都會被存；`verify_authentication` 不驗簽章，只查 DB 是否存在，且 `app/api/v1/webauthn.py` 沒有任何路由呼叫它。
   - `frontend/src/components/WebAuthnPanel.tsx` 掛在 `SettingsPage.tsx`，使用者註冊後實際上沒有任何保護。
   - 建議：先隱藏面板或標示「尚未啟用」；要做就引入 `py_webauthn` 做完整 registration/authentication 驗證，並決定它要 gate 什麼（登入第二因子或 vault 解鎖）。

4. 依賴有已知漏洞，CI 不會擋。

   | 套件 | 目前版本 | 狀態 | 修復版本 |
   |------|----------|------|----------|
   | starlette | 0.52.1 | pip-audit 標出多個 PYSEC-2026 advisories | 1.3.1 以上 |
   | python-multipart | 0.0.22 | pip-audit 標出多個 advisories | 0.0.31 以上 |
   | axios | 1.6.x | npm audit high：prototype pollution、credential leak、header injection | 依 `npm audit` 指示 |
   | form-data | 4.0.x | npm audit high：CRLF injection | 依 `npm audit` 指示 |
   | follow-redirects | 1.15.x | npm audit moderate | 依 `npm audit` 指示 |

   - `.github/workflows/ci.yaml` 的 `pip-audit --strict` 設了 `continue-on-error: true`，frontend job 沒有 `npm audit`。
   - 建議：升級後移除 `continue-on-error`，frontend job 加 `npm audit --omit=dev --audit-level=high`。`pyproject.toml` 對 `bcrypt<4.0.0` 的 pin 是為了 passlib；passlib 已無維護，中期可改直接用 `bcrypt` 或 `argon2-cffi`。

### 中

5. Tailscale 檢查與登入限流都信任可偽造的 `X-Forwarded-For`。
   - `app/core/tailscale.py` 的 `get_client_ip` 與 `app/core/rate_limit.py` 的 `_get_client_ip` 都取 XFF 第一個值。`frontend/nginx.conf` 用 `proxy_add_x_forwarded_for`，是「附加」不是「覆寫」，客戶端自帶的值會排最前面。
   - 只要任何路徑能不經 Tailscale 打到 nginx 或 backend（例如誤把 port 映射到 LAN），IP 檢查與 `/auth/login`、`/setup/admin` 的 10 次/分鐘限流都可用一個 header 繞過。
   - `slowapi` 用記憶體計數，`Dockerfile` 以 `--workers 2` 啟動，限流實際打對折，重啟歸零。
   - 建議：nginx 改為 `proxy_set_header X-Forwarded-For $remote_addr`（覆寫），後端只信任來自 nginx 的 header；限流改用共享儲存或單 worker；把 Tailscale 檢查視為縱深防禦而非主要邊界。

6. 同一份 `.env` 同時給開發與 Docker 用，現在的內容會讓正式環境以 development 模式啟動。
   - 本機 `.env` 是 `APP_ENV=development`、`APP_DEBUG=true`、`REQUIRE_TAILSCALE=false`。`docker-compose.yaml` 的 `${APP_ENV:-production}` 會讀同目錄 `.env` 做插值，`env_file: .env` 又把整份塞進容器。
   - development 模式下 `app/main.py` 開 CORS `allow_origins=["*"]`、公開 `/docs` 與 `/redoc`、SQLAlchemy `echo=True` 把 SQL 打進 log。
   - `app/config.py` 的 `secret_key` 預設值 `change-this-secret-key-in-production` 沒有啟動檢查。
   - 建議：拆成 `.env`（dev）與 `.env.production`，compose 明確指定 `env_file`；`Settings` 在 `is_production` 且 `secret_key` 為預設值或短於 32 字元時拒絕啟動。

7. OAuth 流程沒有 `state`，也沒檢查 `verified_email`。
   - `app/api/v1/oauth.py` 的 `google_authorize` 不產生 `state`，`google_callback` 不驗證。login CSRF 的基本防護沒做。
   - callback 找不到 `google_id` 時以 email 比對既有使用者並自動連結（包括 setup 精靈建立的 admin）。Google userinfo 有 `verified_email` 欄位但程式沒看；非 Gmail 的 Google 帳號可掛未驗證 email，理論上能接管預建帳號。
   - 建議：authorize 產生隨機 `state` 存於 sessionStorage 或 httpOnly cookie，callback 比對；只接受 `verified_email == true`；考慮改用 ID token 並驗證 `aud`/`iss`。

8. Refresh token 走 query string。
   - `frontend/src/services/api.ts` 送 `POST /auth/refresh?refresh_token=...`，`app/api/v1/auth.py` 以 query 參數接收。會完整進 nginx access log 與任何中間代理 log。
   - 建議：改為 JSON body。

9. Service worker 把 API 回應快取到磁碟，登出不清。
   - `frontend/public/sw.js` 對所有 `/api/` GET 用 network-first 並寫進 Cache Storage `api-v1`，包含 `/auth/vault/keys`（加密私鑰與 salt）與全部憑證密文。登出與自動上鎖都沒有清快取。
   - 裝置被拿走就多一份離線暴力破解素材；`MasterPasswordModal.tsx` 的 vault 密碼最低只要 8 字元。
   - 建議：SW 不快取 `/api/`（或只快取非敏感路徑），登出時刪除 `api-v1` cache；vault 密碼最低 12 字元或接 zxcvbn。

10. 持有 access token 就能永久刪除所有憑證。
    - `app/api/v1/credentials.py` 的 `DELETE /{id}` 只檢查 JWT，不需要解鎖 vault；前端有 `credentialService.deleteAll`。伺服器端沒有備份，`.cvault` 匯出是手動的。
    - token 被偷的最壞情況不是洩漏，是資料消失。
    - 建議：硬刪改為需要 vault 解鎖證明（例如用私鑰簽一個 server challenge），或改為只允許 revoke 並保留 N 天後才真正刪除；提供自動 `.cvault` 備份提醒。

### 低

11. 密文沒有版本號也沒綁 credential id。
    - `encryptCredential` 的格式是 `len + wrapped_key + iv + ciphertext`，沒有 AAD。被入侵的伺服器可以把同一使用者的兩筆 blob 互換或回滾舊值而不被偵測。
    - `KDF_VERSION` 常數沒存進 DB，未來調 Argon2 參數時無法辨識舊資料。
    - `setupVault` 後直接放進記憶體的私鑰是 extractable（產生時需要匯出），解鎖流程匯入的才是 non-extractable；建議 setup 後重新 import 一次。
12. 沒有更改 vault 密碼或重新加密的功能。`/auth/vault/setup` 已有金鑰就回 400，使用者只能匯出、砍掉重建。
13. `templates` 表是明文 JSON（`app/models/template.py`），`frontend/src/types/template.ts` 有 `defaultValue` 欄位。使用者若在範本放預設值，伺服器看得到。
14. `/auth/login` 的 403 訊息「Local login is restricted to admin users」會洩漏帳號存在；不存在的 email 不跑 bcrypt，有 timing 差異。
15. 文件與程式碼不符。
    - 舊版 `AGENTS.md` 與 `QUICKSTART.zh-TW.md` 的 `MFA_ISSUER` 說明暗示有 TOTP MFA，實際 `app/api/v1/stubs.py` 讓 `/totp/*` 全部回 503。`AGENTS.md` 已於本次更新修正。
    - `SPEC-003` 的 Open Questions 寫 PBKDF2 600K 與 metadata 明文，程式碼實際是 Argon2id 與全加密。方向是好的，但 spec 落後。
    - `docker-compose.yaml` 仍傳入已無人使用的 `ENCRYPTION_KEY`；tailscale sidecar 用 `TS_USERSPACE=true` 卻加了 `NET_ADMIN` 與 `SYS_MODULE`。
16. 非安全但會咬人的 bug。
    - `arrayBufferToBase64` 用 `String.fromCharCode(...new Uint8Array(buffer))` 展開整個陣列，大一點的 blob（例如含完整私鑰的備份）會 `RangeError`。
    - `Dockerfile` 切到 `appuser` 執行，但套件裝在 `/root/.local` 且 `PATH` 指向那裡；非 root 很可能讀不到。未實際 build 驗證，列為待確認。

## 建議處理順序

1. 密碼產生器改純前端，刪掉四個 `/tools` 密碼端點（第 1 項）。
2. nginx 加 CSP 與 HSTS，refresh token 改走 body，service worker 不快取 `/api/`（第 2、8、9 項）。
3. 升級 starlette、python-multipart、axios、form-data、follow-redirects，移除 CI 的 `continue-on-error`，frontend job 加 `npm audit`（第 4 項）。
4. 隱藏 WebAuthn 面板，或補完整驗證（第 3 項）。
5. 拆開 `.env` 與 `.env.production`，加 `SECRET_KEY` 預設值啟動檢查（第 6 項）。
6. OAuth 加 `state` 與 `verified_email` 檢查（第 7 項）。
7. nginx 覆寫 XFF、限流改共享儲存（第 5 項）。
8. 刪除保護與備份提醒（第 10 項），其餘低風險項目視排程處理。

## 未驗證事項與限制

- 沒有對執行中的服務做動態測試；XFF、CSP、SW 快取的行為是從程式碼與設定推論。
- Tailscale Serve 對 `X-Forwarded-For` 是覆寫還是附加，沒有在 tailnet 上實測。即使是覆寫，第 5 項在 port 被誤暴露時仍成立。
- Docker 映像沒有 build，`appuser` 讀不到 `/root/.local` 的推論待驗證。
- `pip-audit` 與 `npm audit` 的 advisory 編號來自 2026-10-23 的工具輸出，升級前請重跑。

## 處理狀態

- 2026-10-23：審查完成，修復進度如下。`AGENTS.md`、`CLAUDE.md`、`docs/AGENT-GUIDE.md` 已更新以反映 TOTP/WebAuthn 的實際狀態與零知識不變量。
- 第 1 項（密碼產生器）已修復：產生、強度分析、HIBP 查詢移到 `frontend/src/lib/passwordTools.ts`，使用 `getRandomValues` 與 rejection sampling；刪除 `app/api/v1/tools.py`、`app/core/password_generator.py`、`password_strength.py`、`hibp.py` 與對應測試。
