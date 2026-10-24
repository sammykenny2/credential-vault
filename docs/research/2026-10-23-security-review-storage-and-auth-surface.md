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

- 沒有對執行中的服務做動態測試；XFF、CSP、SW 快取的行為是從程式碼、設定與單元測試推論。nginx 設定已用 `nginx -t` 驗證語法。
- Tailscale Serve 對 `X-Forwarded-For` 是覆寫還是附加，沒有在 tailnet 上實測。修復後的信任代理鏈解析對兩種情況都正確，但整套 compose 堆疊在 NAS 上尚未實際啟動驗證。
- Docker 映像已於 2026-10-23 本機 build 並 smoke test（後端：以 `appuser` 執行 `alembic upgrade head` 與 `import app.main`；前端：`nginx -t`）。尚未測試 compose 三個容器一起啟動與 Tailscale Serve 路由。
- `pip-audit` 與 `npm audit` 的 advisory 編號來自 2026-10-23 的工具輸出，升級前請重跑。
- 沒有獨立的第二位審查者看過這些修改；所有測試都是作者自跑。

## 處理狀態

- 2026-10-23：審查完成，修復進度如下。`AGENTS.md`、`CLAUDE.md`、`docs/AGENT-GUIDE.md` 已更新以反映 TOTP/WebAuthn 的實際狀態與零知識不變量。
- 第 1 項（密碼產生器）已修復：產生、強度分析、HIBP 查詢移到 `frontend/src/lib/passwordTools.ts`，使用 `getRandomValues` 與 rejection sampling；刪除 `app/api/v1/tools.py`、`app/core/password_generator.py`、`password_strength.py`、`hibp.py` 與對應測試。
- 第 2 項前半（CSP/HSTS）與第 9 項已修復：`frontend/security-headers.conf` 經 `include` 套到 nginx 每個 location，含 CSP、HSTS、frame-ancestors；`sw.js` 對 `/api/` 改 network-only 並在 activate 時刪除舊的 `api-v1` cache；新 vault 密碼最低 12 字元（`MasterPasswordModal.tsx`）。token 改 httpOnly cookie 另見下一條。
- 第 2 項後半與第 8 項已修復：refresh token 只以 HttpOnly、SameSite=Strict、Path=/api/v1/auth 的 cookie 發放（`app/core/session.py`），不再出現在回應 body 或 query string；access token 只存在前端記憶體（`authStore.ts` 不再 persist），頁面重載時由 `App.tsx` 靜默 refresh 還原。新增 `users.token_version`（migration `3f9c2d1e7b40`），所有 JWT 帶 `ver`，`POST /auth/logout` 遞增版本即撤銷該帳號所有裝置的 token，並清除前端記憶體中的 vault 金鑰。順手修掉 `oauth.py` 建立新使用者時 `settings` 未定義的 NameError。
- 第 4 項已修復：Python 升到 fastapi 0.161.1、starlette 1.9.0、python-multipart 0.0.32、uvicorn 0.54.0、pydantic-settings 2.14.2，`python-jose` 換成 `PyJWT`（移除無修復版本的 `ecdsa`），`pip-audit` 歸零；前端 `npm audit fix` 後再把 `react-router-dom` 升到 7.18.4（API 相容，移除 v6 future flags），正式依賴 `npm audit --omit=dev` 歸零，剩餘 7 個都是 vite/esbuild/ws 等開發工具且需要 breaking 升級，未處理。CI 的 `pip-audit --strict` 移除 `continue-on-error`，frontend job 加 `npm audit --omit=dev --audit-level=high`；`ruff check`、`ruff format --check`、`mypy app/` 現在全部通過。
- 第 3 項已處理：移除未驗證 attestation/簽章的 WebAuthn 實作（`app/api/v1/webauthn.py`、`app/services/webauthn_service.py`、`app/schemas/webauthn.py`、前端 `WebAuthnPanel.tsx` 與 `webauthnService.ts`），`/api/v1/webauthn/*` 改為與 TOTP 相同的 503 stub，設定頁不再顯示 Passkey 區塊。`webauthn_credentials` 資料表與 model 保留，供日後以 `py_webauthn` 做完整實作。
- 第 6 項已修復（含第 15 項的 compose 清理）：`app/config.py` 在 `APP_ENV=production` 時拒絕預設或短於 32 字元的 `SECRET_KEY` 與 `APP_DEBUG=true`（`tests/unit/test_config.py`）；環境變數拆成 `.env.example`（本機開發）與 `.env.production.example`（NAS 部署），`docker-compose.yaml` 改以 `docker compose --env-file .env.production up -d` 啟動、`APP_ENV=production` 寫死在 compose、移除 `ENCRYPTION_KEY` 與 tailscale sidecar 不需要的 `NET_ADMIN`/`SYS_MODULE`；`.env.production` 已加入 `.gitignore`；QUICKSTART、README、`config/tailscale/README.md` 同步更新，移除 `MFA_ISSUER` 等無效設定。
- 第 7 項已修復：`GET /oauth/google/authorize` 必須帶 16 字元以上的 `state`，前端 `lib/oauthState.ts` 以 sessionStorage 保存 state 與流程類型（login/link），callback 時比對不符就拒絕；`exchange_google_code` 要求 Google userinfo 的 `verified_email` 為 true 才接受；授權請求改 `prompt=select_account` 並移除用不到的 `access_type=offline`。OAuth 流程不再使用 localStorage。
- 第 5 項已修復：新增 `app/core/client_ip.py`，只有直接連線端屬於 `TRUSTED_PROXIES`（預設 loopback 與 `172.16.0.0/12`）時才採用 `X-Forwarded-For`，並從右往左跳過信任節點取第一個外部位址，`X-Real-IP` 不再被信任；Tailscale 中介層、slowapi 限流、審計紀錄、request log 全部改用它。nginx 維持 `proxy_add_x_forwarded_for`（附加）即可正確運作。`Dockerfile` 改為單一 uvicorn worker，讓記憶體內的限流計數正確。
- 第 10 項已修復：新增 proof-of-unlock。`POST /auth/vault/challenge` 以使用者的 RSA-OAEP 公鑰加密 32 bytes 隨機值（伺服器只存 SHA-256），客戶端用記憶體中的私鑰解開後以 `X-Vault-Proof` header 回傳，5 分鐘內可重複使用；`DELETE /credentials/{id}` 與覆寫 `encrypted_data` 的 `PATCH` 都要求有效 proof（`app/core/vault_proof.py`、`app/api/deps.py` 的 `VaultProvenUser`，migration `5c7e1a9b2d44`）。前端 `lib/vaultProof.ts` 自動取得並快取 proof，vault 上鎖時刪除會失敗並跳出解鎖視窗。另加 30 天 `.cvault` 備份提醒（`lib/backupReminder.ts`，憑證頁橫幅）。殘餘風險：admin 硬刪使用者的端點仍只需 admin token，admin 不一定有 vault，未納入 proof。
- 第 11 項已修復：憑證密文改為 v2 格式（`0xFF 0x02` 前綴），以 credential id 作為 AES-GCM additional data，id 由客戶端產生並隨 `POST /credentials` 送出（伺服器拒絕重複 id）；被入侵的伺服器把 blob 搬到別筆憑證會解密失敗。舊 v1 blob 仍可讀。`users.kdf_version`（migration `6d8f2b0c3e55`）隨金鑰儲存，`/auth/vault/keys` 回傳給前端選參數。setup 後存於記憶體的私鑰改為 non-extractable。`arrayBufferToBase64` 改分塊，解掉大 blob 的 RangeError（第 16 項前半）。回滾偵測未處理（需客戶端狀態）。
- 第 12 項已修復：`PUT /auth/vault/keys`（需 `X-Vault-Proof`）只替換包裹後的私鑰、salt 與 `kdf_version`，公鑰與憑證不變；前端 Settings 新增「Change Vault Password」區塊，用 `rewrapPrivateKey` 以舊密碼解開 PKCS8 再以新密碼與新 salt 包回，舊密碼錯誤時 GCM 驗證失敗不會送出任何東西。
- 第 14 項已修復：`POST /auth/login` 所有失敗情況（帳號不存在、沒有密碼、非 admin、密碼錯誤）一律回 401「Invalid credentials」，且每次都做一次 bcrypt 驗證（不存在時比對 `DUMMY_PASSWORD_HASH`），消除帳號列舉與 timing 差異；只有密碼正確但帳號停用才回 403。
- 第 13 項已修復：`TemplateField` 加驗證，`isSecret` 欄位帶 `defaultValue` 一律 422（建立、更新、sync 共用 schema）；範本編輯器加上「範本未加密、只定義欄位名稱」提示。
- 第 15 項已修復：`SPEC-003` Open Questions 改為實際狀態（Argon2id、全加密 metadata、v2 blob、X-Vault-Proof、離線功能清單）；`ROADMAP.md`、`PROGRESS.md` 移除 MFA 已實作的描述；compose 的 `ENCRYPTION_KEY` 與多餘 caps 已在第 6 項移除。
- 第 16 項已修復：`Dockerfile` 改為 builder 建 `/opt/venv` 再複製到 runtime，`appuser` 可讀；啟動時先 `alembic upgrade head` 再起 uvicorn。實際 build 與 smoke test 又抓到兩個部署會壞的問題並修掉：`pyproject.toml` 的 `sqlalchemy` 缺 `[asyncio]` extra（映像裡沒有 greenlet，本機 venv 有所以沒發現）；`frontend/` 沒有 `.dockerignore`，`COPY . .` 把 Windows 的 `node_modules` 蓋掉容器內剛裝好的套件導致 `npm run build` 失敗。根目錄與 `frontend/` 都加了 `.dockerignore`。`arrayBufferToBase64` 的 RangeError 已在第 11 項修掉。
- 第 4 項補完：剩餘 7 個 dev 工具鏈 advisory 全部來自 Tailwind 3 的相依樹（`braces`、`postcss-selector-parser`），已用官方 `@tailwindcss/upgrade` 升到 Tailwind 4.3（CSS-first 設定寫在 `src/index.css` 的 `@theme`，`tailwind.config.js` 與 `autoprefixer` 移除，PostCSS 改用 `@tailwindcss/postcss`）。`npm audit` 含 dev 依賴歸零。注意：升級工具會把一般字串裡長得像 class 的字（`blur`、`ring`、`shadow`）改寫，`src/lib/passwordTools.ts` 的字典被誤改已還原；日後跑任何 class 遷移工具都要逐檔看 diff。
- 16 項全部處理完畢（2026-10-23）。殘餘：admin 硬刪使用者只需 admin token；密文回滾偵測未做；compose 全套未在 NAS 實測。
- 第 4 項再補完：`npm outdated` 全部升到最新（React 19、Vite 8、Vitest 5、jsdom 30、TypeScript 6.0（typescript-eslint 尚未支援 7）、ESLint 10 + react-hooks 7、zustand 5、lucide-react 1、react-query 5.104）。Node 需 22.22+，CI 與前端 Dockerfile 改用 Node 22。react-hooks 7 的 React Compiler 規則找出 6 處在 effect 內同步 setState 的寫法，已改成衍生狀態、以 `key` 重掛載或改用 react-query；憑證明文的解密改放在 `gcTime: 0` 的 query 裡，上鎖或關閉視窗就立即丟棄，比原本的 effect 清除更可靠。`npm audit` 與 `npm outdated` 都歸零。
- 2026-10-24 部署流程：正式環境改由 `scripts/windows/Deploy-CredentialVault.ps1` 部署（build → 停後端 → 備份 → `up -d` → 健康檢查與 tailnet HTTPS 檢查；另有 `-Backup`、`-Restore`、`-Rollback`、`-Status`、`-Stop`）。compose 原本把 `./data` 掛進容器，而那正是開發用的資料庫，第一次 `up` 會讓正式容器對開發資料庫跑 migration；已改成 named volume `credential-vault_vault_data`，順帶避開 Windows NTFS 掛載的 SQLite 鎖定問題與 NAS 主機資料夾權限問題。`TS_HOSTNAME` 原本寫在範本裡但 compose 寫死，現在真的生效；映像檔名稱固定為 `credential-vault-{backend,frontend}:${VAULT_IMAGE_TAG:-local}`，可 `docker save`/`load` 搬到別台主機。備份/還原由映像檔內的 `python -m app.maintenance` 執行（SQLite online backup API、integrity check、還原後 chown 給 `appuser` 並設 0600，`tests/unit/test_maintenance.py`）。在 Docker 內實測又抓到兩個部署會壞的既有問題：前端 HEALTHCHECK 打 `localhost` 會解析成 `::1`，nginx 只聽 IPv4，容器永遠 unhealthy（改 `127.0.0.1`）；`TailscaleMiddleware` 在 middleware 裡 raise `HTTPException`，FastAPI 的例外處理接不到，非 tailnet 請求回 500 加 traceback 而不是 403（改回傳 `JSONResponse`，`tests/unit/test_tailscale.py` 加中介層測試）。兩者都是 fail-closed，沒有放行請求。
- 2026-10-24 CI 發布：`ci.yaml` 的 `docker` 驗證 job 換成 `publish`，在其他 job 通過後 build 兩個映像檔，只有 main 才推到 GHCR（標籤為 commit SHA 與 `latest`），把 digest 記成 commit status（`release/backend`、`release/frontend`），並以 `actions/delete-package-versions` 只保留最新 5 版。新增的 `docker/*` action 以 commit SHA 固定版本（`docker/login-action` 刻意選 v4.6.0，不用前一天才發布的 v4.7.0）。部署腳本預設部署最新的 CI release：透過 `gh api` 讀 status 取得 digest，以 digest 拉映像檔，並要求 `org.opencontainers.image.revision` 等於該 commit，然後才 tag 成 compose 使用的 `:local`，因此光有 GHCR 憑證無法改變部署內容；`-Build` 保留本機建置。因為 repo 是 private，GitHub 的 artifact attestation 需要 Enterprise Cloud 才能用，所以改用 commit status 作為可信管道。發布 job 的 `provenance`/`sbom` 必須維持關閉，否則 attestation manifest 會被保留 5 版的步驟算進去刪掉。未實測：發布 job、`GITHUB_TOKEN` 能否刪除使用者帳號下的 package 版本、拉取模式（都要等 Actions 額度恢復）。
- 2026-10-24 首次正式部署（這台 Windows，Docker Desktop）：compose 全套第一次實際跑起來，又抓到一個部署會壞的問題。Tailscale Serve 的路徑 handler 會去掉掛載路徑，原本 `serve.json` 把 `/api`、`/health` 直接轉給後端，後端收到的是 `/v1/...` 與 `/`，整個 API 都是 404（網頁本身照常載入，只看首頁看不出問題）。改成 Serve 只把 `/` 轉給 nginx，`/api` 與新增的 `/health` 由 nginx 轉給後端；部署腳本的端到端檢查改為要求後端回 JSON，並在 `serve.json` 比 sidecar 啟動時間新時重啟 sidecar。tailnet 上實測確認：Tailscale Serve 會帶 `X-Forwarded-For`，經 nginx 附加後，後端以 `TRUSTED_PROXIES` 解析出的來源是 tailnet 位址（`100.66.45.5`），`REQUIRE_TAILSCALE` 放行；API 回應帶 HSTS 與 CSP。上面「XFF 是覆寫還是附加沒有在 tailnet 上實測」一項已解決；NAS 上仍未實測。
- 2026-10-24 表單欄位：原本 `main.tsx` 以 MutationObserver 把所有 `<input>` 設成 `autocomplete="off"`，但 Chrome 對帳號密碼欄位忽略它、沒處理 `<textarea>`，也會蓋掉正確的提示。改為逐欄宣告：帳號欄位用標準 token（設定頁 `username`/`nickname`/`new-password`，緊急登入與驗證 `current-password`）；憑證值、備註、vault 主密碼與備份/匯出密碼用 `secretFieldProps`（autocomplete off、spellcheck off、各家密碼管理器與 Grammarly 的忽略屬性）；其他私密文字用 `privateFieldProps`。重點是備註 textarea 原本預設開著拼字檢查，且顯示成明文的密碼欄在 Chrome 加強型拼字檢查或 Edge Microsoft Editor 下會被送到雲端（spell-jacking）。殘餘：Chrome 對密碼欄的「儲存密碼」提示無法以網頁屬性關閉，使用者需在 Chrome 對此網站選「一律不儲存」，以免憑證或主密碼進入同步到 Google 帳號的密碼管理員。`inputProps.test.tsx` 掃描原始碼，未宣告的欄位會讓測試失敗。
- 2026-10-24 CSP 與瀏覽器快取：`68cb721` 在 CSP 加入 `'wasm-unsafe-eval'` 後，Firefox 仍反覆出現「WebAssembly.compile() blocked by CSP」。`b399199` 的判斷（文件沒有 `Cache-Control`，靠 `Last-Modified` 的啟發式新鮮度沿用舊文件）只對了一部分，真正的機制是 service worker 從未更新：nginx 的 `location /sw.js` 是前綴 location，會被靜態資源的 regex location（`~* \.(js|...)$`）蓋過，`sw.js` 實際以 `max-age=31536000, immutable` 送出，Firefox 的更新檢查因此一直拿到快取的舊檔。第一次部署時裝上的舊 SW（`static-v2`）預先快取了當時的 `index.html`（不含 `'wasm-unsafe-eval'` 的 CSP），重置或部署期間請求失敗時就回放這份文件；重置後的 nginx access log 裡，Firefox 完全沒有向伺服器要求 `/` 或 `/sw.js`，第一個請求就是 API。修正：改成 `location = /sw.js`（精確比對優先於 regex）；`main.tsx` 改註冊 `/sw.js?v=4`，新網址沒有快取，卡住的瀏覽器會安裝新 SW，activate 時刪掉 `static-v2`；`securityHeaders.test.ts` 檢查沒有前綴 location 被靜態資源 regex 蓋過；部署腳本在端到端檢查後實際抓 `/` 與 `/sw.js` 的標頭（文件必須 `no-cache` 且 CSP 含 `'wasm-unsafe-eval'`，`sw.js` 必須 `no-cache` 且不得 `immutable`），不符就判定部署失敗。原本的測試只比對設定檔文字，抓不到 location 優先順序，所以正式環境錯了測試仍通過；只有對執行中服務的實際請求才抓得到。已受影響的瀏覽器需在部署完成、健康檢查通過後按一次 Ctrl+F5。
- 2026-10-24 第一位管理員：清空資料庫重新部署後，後端還在啟動時 `/api/v1/setup/status` 回 502，登入頁的後備邏輯（狀態檢查失敗就直接顯示登入）讓 Google 登入建出一般使用者；`.env.production` 沒設 `ADMIN_EMAIL`，所以沒有升級，系統一直沒有管理員，tailnet 上任何裝置打開網站都會進 `/admin/setup`、可搶先成為管理員。已以 `vault-cli promote-admin` 把該帳號升為管理員。修正：沒有管理員時，Google 登入的帳號成為管理員（設了 `ADMIN_EMAIL` 則只限該帳號），對既有帳號也適用，並記錄 `USER_ROLE_CHANGED`；登入頁不再強制跳 `/admin/setup`，改為說明並連到 `/admin/setup`，狀態檢查失敗時持續重試、不顯示登入；新增 `PUT /users/me/password`，讓沒有密碼的管理員補上密碼（需 `X-Vault-Proof`，已有密碼回 409，一般使用者 403），補上後帳號與 `/admin/setup` 建立再綁 Google 的帳號相同。先搶先贏的風險與 `/admin/setup` 相同，只在沒有管理員時存在。測試：`tests/integration/test_api_oauth.py`、`test_api_user_password.py`、`frontend/src/__tests__/loginPage.test.tsx`。
- 2026-10-24 登入密碼與帳號管理：檢查上一項新增的 `PUT /users/me/password` 時找到兩個問題。其一，登入密碼每次登入都以明文送到伺服器，vault 主密碼從不離開瀏覽器；兩者若相同，伺服器就拿到主密碼，配上資料庫裡的 salt 與包裝過的私鑰即可解開全部 credential，而介面沒有任何阻擋。修正：`AdminPasswordSetup` 送出前在瀏覽器以新密碼嘗試解開私鑰（`frontend/src/lib/crypto.ts` 的 `isVaultPassword`，KDF 失敗時拋錯、不會默默放行），解得開就拒絕；反方向（把 vault 主密碼改成登入密碼）無法在不送出主密碼的情況下檢查，`VaultPasswordChange` 只對有登入密碼的管理員提示。其二（原本就有）：`PATCH /users/{id}/role`、`POST /users/{id}/reactivate`、`PATCH /users/{id}`、`POST /users/`、`DELETE /users/{id}` 只要 admin token，偷到 token 的人可以把自己的帳號升為管理員而長期保有權限，也能刪掉別人的整個 vault。修正：新增 `VaultProvenAdmin`（`app/api/deps.py`），這五個端點都要 `X-Vault-Proof`，管理員必須先解鎖 vault 才能管理使用者；`PATCH /users/{id}` 補上與 `DELETE` 相同的「不能停用自己／最後一位管理員」保護並記錄 `USER_UPDATED`。順帶：沒有手動鎖定 vault 的功能，自動鎖定也只在下次用到金鑰時才清掉記憶體中的私鑰；側邊欄新增 Lock Vault（清除私鑰與快取的 proof），並每 10 秒檢查逾時，鎖定後 Credentials 頁關閉顯示明文的視窗；`.btn`、`.input` 補上 disabled 樣式（原本停用的欄位看起來和可用的一樣）。測試：`tests/integration/test_api_users.py`、`frontend/src/__tests__/adminPasswordSetup.test.tsx`、`adminUsersPage.test.tsx`、`vaultLockControl.test.tsx`、`crypto.test.ts`。
- 2026-10-24 決定不檢查登入密碼與 vault 主密碼是否相同，拿掉上一項的 `isVaultPassword` 檢查與兩處提示。原因：只能擋單一方向（先有 vault、後補登入密碼）；先走 `/admin/setup` 再設 vault 主密碼的方向，瀏覽器沒有登入密碼可比對，要擋就得把主密碼或登入密碼的雜湊送來送去。兩組密碼由使用者自己決定，風險（登入密碼每次登入都會送到伺服器）由使用者承擔。上一項的 `VaultProvenAdmin`、Lock Vault 與 disabled 樣式不受影響。
- 2026-10-24 手動鎖定的按鈕從側邊欄移到 Credentials 頁右上角（Backup 旁的 Lock）；鎖定邏輯與自動鎖定的定時檢查搬到 `frontend/src/hooks/useVaultLock.ts`（`lockVault`、`useAutoLock`），`useAutoLock` 掛在 Layout，在任何頁面都會準時鎖定。測試：`frontend/src/__tests__/vaultLock.test.tsx`。
- 2026-10-24 repo 改為 public，`ci.yaml` 恢復 push 與 pull request 觸發（public repo 的 Actions 不受額度限制）。公開前掃過整個 git 歷史：沒有提交過 `.env`/`.env.production`、資料庫或真實金鑰，命中的只有範例字串（`tskey-auth-xxx`、範本的 placeholder、AWS 文件的範例 key），`tail1234` 也是範例；作者 email 早已出現在其他 public repo 的 commit 中。本文件列出的未處理問題隨之公開，服務只在 tailnet 上，風險低。CI 修正兩處：`pip-audit --strict` 會因為 editable 安裝的 credential-vault 不在 PyPI 而失敗，改成只稽核 `pip freeze --exclude-editable`；ruff 0.17 會格式化 Markdown 裡的程式碼，`pyproject.toml` 把 `*.md` 排除。實測（run 40100564747）：發布 job 成功，`release/*` status 已記錄，GHCR 映像檔隨 repo 變成 public，不登入即可拉取。仍未實測：保留 5 版的刪除（要第 6 次發布才會刪）、部署腳本的拉取模式。repo 變成 public 後也可以改用 GitHub artifact attestation，目前仍以 commit status 為準。
- 2026-10-24 部署腳本的拉取模式已實測：不帶參數部署了 `501cad8` 的 CI release（以 digest 拉取、核對 revision 標籤、部署前備份、健康與標頭檢查都通過）。之後改成以 `VERSION` 發版：每次 push 都跑測試並試 build，只有 main 上 `VERSION` 是新版號時才推映像檔、記 `release/*` status、建立 GitHub release `v<VERSION>`（`publish` job 因此需要 `contents: write`；fork 的 PR 拿到的 token 仍是唯讀）。`validate` 擋下格式不對或比最新 release 小的版號。部署腳本的 `latest` 改為最新的 GitHub release（原本只掃 main 最近 30 個 commit，發版變少後會找不到），`-Tag` 接受版號，並要求映像檔的 version 標籤相符。介面顯示 bundle 的版號與 commit，`/health` 回報伺服器的 `version` 與 `revision`，兩者不同時提示重新整理（偵測 service worker 或快取留下的舊介面）。`/health` 原本就公開版號；repo 是 public，多回報 commit 不增加資訊。compose 的 `TS_AUTHKEY` 改為 `${TS_AUTHKEY:-}`，不再出現未設定的警告。
- 2026-10-24 拿掉非發版時的試 build：發版判斷移到 `validate`（輸出 `version`、`publish`），`publish` job 只在發版時執行，其他 push 與 PR 只跑測試。代價是 Dockerfile 的問題要到發版才會發現；發版失敗不會建立 tag，修好後以同一版號再 push 即可。
