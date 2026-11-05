# PLAN-004: 結構化憑證、集合與加密附件

> Implementation Plan

## Metadata

| Field | Value |
|-------|-------|
| **Status** | Draft；Phase 0 gate 未通過，不得進入格式定案 |
| **Owner** | 專案維護者 |
| **Assigned To** | 實作時指定 |
| **Reviewer** | 已收到外部原稿設計審閱；修正版與程式修補仍待獨立重審 |
| **Baseline** | `2d41d37`；2026-11-05 |

## Related Spec

[SPEC-004: 結構化憑證、集合與加密附件](../specs/SPEC-004-structured-credentials-and-attachments.md)。
架構理由見 [ADR-003](../decisions/003-structured-credentials-and-attachments.md)；
金鑰信任、簽章與 padding 以前置 [ADR-004](../decisions/004-vault-authenticity-and-key-trust.md) 為準。

## Overview

先完成 Phase 0 的既有服務修補、部署驗證與設計重審，才固定資料格式、限制與測試向量，再實作 migration、revision／batch、
瀏覽器加密與欄位 UI，最後完成集合／關聯、備份還原及真實部署驗證。
每個階段以合成資料驗證，不接觸真實秘密。中間 commit 可供審閱，但功能在全部安全與備份條件
完成前不發版，避免形成只能保存、無法完整還原的附件功能。
這項限制針對新附件功能；Phase 0 的既有服務熱修補應獨立發版，不等待新格式實作。

本文件區分既有服務熱修補與尚未實作的新格式。用途隔離、公私鑰綁定、備份密碼門檻已在 main（`97224aa`）；
紀錄簽章、key bundle 與 proof v2 已在分支實作。兩者都未部署；其餘 gate 不因文件更新而視為完成。不執行資料重置或未授權 migration。

## Implementation Phases

### Phase 0: 既有服務修補與信任前提

- [ ] Task 0.1：驗證既有 proof 專用 OAEP label 的前後端向量、交叉用途拒絕、TTL／長度界線與鎖定 race。
  本地修補及 regression 已建立，須獨立驗證後成套部署；不提供 empty-label 相容回退。
- [ ] Task 0.2：驗證由解開的 PKCS8 導出公鑰、API 不符即拒絕、之後只用導出值；確認 session 私鑰 non-extractable。
  本地修補及正常／替換／壞格式測試已建立，介面會把不符與密碼錯誤分開顯示；須驗證部署版本。
- [ ] Task 0.3：新備份門檻至少 12 字元、CSPRNG 復原秘密至少 128 bits，舊短密碼備份可讀。
  本地 helper／UI 修補已建立；部署驗收與新 v2 備份仍需各自驗證。
- [x] Task 0.4a：實作 ADR-004 的 key bundle、紀錄簽章、proof v2 與 RSA-only vault 的一次性升級（既有 credential）。
- [ ] Task 0.4b：上述實作與 4 KiB padding 設計獲獨立重審，記錄意見及解決狀態。
  2026-11-05 已有兩輪獨立審查，提出的問題已修正，最後一批小修正未再審；padding 尚未審閱。
- [x] Task 0.4c：`POST /auth/vault/setup` 要求該 session 在 10 分鐘內實際登入。登入時間寫在 token 的 `auth_time`，刷新時原樣保留、不重算，沒有這個 claim 的舊 token 一律拒絕，並回 403 `recent_login_required`。這只縮短窗口：10 分鐘內被偷的 token 仍可在沒有 vault 的帳號上安裝金鑰；要完全擋住需在設定時重新走 Google 驗證。
- [ ] Task 0.5：先盤點正式 envelope 版本、DB foreign_key_check 與 journal／FK 預設，只讀取得結果。
  沒有證據不能刪 v1 reader；有 FK 違規時另提修復，禁止清空或自動刪 row。
- [ ] Task 0.6：記錄修補 release／部署版本與瀏覽器重載證據；未部署的利用流程與 PoC 留在本機，
  部署完成後再決定公開研究的範圍。

**Gate**：Task 1.2 的格式定案及 Task 2.5 的 writer 擴張都依賴本階段；目前不得標為通過。
**Acceptance**：AC-19、AC-20、AC-26、AC-34；新簽章及 slots 的完整驗收在後續階段完成。

### Phase 1: 固定格式、能力與限制

- [ ] Task 1.1：將 SPEC-004 的型別整理為 TypeScript discriminated unions 與 runtime parsers，
  分開 legacy read adapter、新格式 writer 與 unknown-version errors。
- [ ] Task 1.2：Phase 0 gate 通過後，定義 template v2、credential v3、collection／attachment v2、
  各用途 OAEP label、padding、batch operations 與 backup v2。Key bundle 與簽章 canonicalization 已由 ADR-004 定案。
  為 UUID 大小寫、UTF-8、長度邊界、secret flag、未知型別及重複 ID 建立測試向量。
- [ ] Task 1.3：明確定義 capabilities、426／409 等 error codes、row revisions、整體 revision 及冪等 receipt。
  列出現有 credential／template 所有 write、sync、import 路徑，確保沒有 legacy bypass。
- [ ] Task 1.4：選定有維護的 ZIP reader/writer，驗證 STORE-only、逐 entry 處理、duplicate-entry 偵測、
  不需 File System Access API，以及授權、bundle 大小與目前瀏覽器相容性。
  停用動態 workers，在現有正式 CSP 實測；不得放寬為 blob: worker、CDN 或 JavaScript eval。
  只增加完成需求必要的依賴，鎖定於 npm lockfile 並執行依賴稽核。
- [ ] Task 1.5：以小型 prototype 驗證 10 MiB 單檔與 240 MiB 附件備份的記憶體模型。
  明確限制同時接收檔案／batch 的數量，並將所有可設定限制納入 capabilities。
- [ ] Task 1.6：在正式實作前取得格式與安全設計的獨立審閱，記錄意見及解決結果。

**Deliverables**：可實作的型別／協定、合成測試向量、dependency 選擇及負載紀錄。
**Gate**：原稿外部審閱僅為輸入。Phase 0、簽章／padding、ZIP／CSP、負載及修正版獨立重審未完成，不進入格式實作。

### Phase 2: 新增式 migration 與寫入一致性

- [ ] Task 2.1：新增 `credentials.revision`、`content_schema_version`；舊 row 設為 1。
  Template 定義另有 schema version，保留現有 `sync_version` 語意。
- [ ] Task 2.2：新增 `vault_state`、`vault_collections`、`vault_batches`、`credential_attachments`，
  另新增全域容量帳本與必要 owner／FK／unique／check constraints。Signer state 與 `credentials.revision` 已存在。
  Runtime、maintenance 與 test engine 每連線在 transaction 前開 foreign_keys=ON；先驗 foreign_key_check。
  維護階段切 WAL，確認 synchronous=FULL、secure_delete=ON、busy_timeout=5000 ms 與顯式 transaction 模式。
  Staged 的預定 credential ID 與 committed FK 分開，支援尚未可見的新紀錄。
- [ ] Task 2.3：實作 vault service 的 prepare／commit／abort／status，所有提交以整體及 row revision CAS。
  使用 UPDATE WHERE revision=expected RETURNING 檢查 affected rows，需要讀後寫時 BEGIN IMMEDIATE；
  禁止 SELECT 後無條件更新。所有 metadata／附件在同一 transaction，明確 commit 成功後才產生 receipt。
  Commit／abort／expire 同時清除 batch payload，只保留 TTL 24 小時的最小 receipt，測試 commit failure／競態。
- [ ] Task 2.4：以條件式原子 UPDATE 保留／釋放 owner 與全域 quota，包含 metadata、retired、staging 及 reservations；
  重複 prepare／upload／commit 不重複占額。新增帳號也不能繞過全域配額，維持 free-space 保留及 ENOSPC rollback。
  不將明文檔名、MIME、金鑰、parent、membership 或關聯放入外部 operation metadata。
- [ ] Task 2.5：僅在 Phase 0 gate 通過後，讓新 writer 接入 protocol 與附件一致性；來源簽章、signed state、proof v2 與 row revision 已套用於既有 credential 寫入。
  多分頁與長時間還原可續 proof；集合與附件沿用同一簽章與 proof。
  現有 template write／sync／import 也檢查 schema 能力；不能由舊欄位 schema 忽略新內容後存回。
- [ ] Task 2.6：實作全量 snapshot cursor，以一致 revision 取得 metadata；分頁中有提交則回衝突。
  同時涵蓋 revoked 紀錄及集合 tombstone，不載入附件 BLOB。
- [ ] Task 2.7：migration 測試覆蓋既有密文未改、筆數未減、user cascade、跨 owner FK，及失敗 rollback。
  Down migration 在存在新版資料時拒絕破壞性刪除，說明 snapshot 還原路徑。
  使用兩個真實連線測 CAS／quota，反向測 invalid FK／cascade、PRAGMA、durable receipt，不能只靠共用 fixture session。

**Deliverables**：migration、批次寫入與讀取介面、owner／proof／capability 邊界及 integration tests。
**Acceptance**：AC-07、AC-09、AC-10、AC-17 的 backend 部分。

### Phase 3: 附件密文傳輸、配額與清理

- [ ] Task 3.1：Batch descriptor／operation／binary 都使用原始 Request，認證／proof／能力／限流前不讀 body。
  Descriptor 64 KiB、operation 1 MiB，32 MiB 只作整批 staged 上限；驗證有限 JSON 後才 model_validate_json。
  新增 owner-scoped binary 下載；串流計算實際 padded bytes／密文 SHA-256，
  同時檢查宣告長度、檔案上限及 reservation。錯誤時釋放 staged bytes，不洩漏秘密至錯誤訊息。
- [ ] Task 3.2：只接受 batch 中預先登記的附件 ID；禁止覆寫 immutable bytes、跨 credential 重用或讀取 pending bytes。
  已完成的相同 upload 可重試，不同內容回錯誤。
- [ ] Task 3.3：commit 檢查完整 active 附件集合、歸屬及大小，替換成功後才將舊附件標 retired。
  暫存上傳失敗、存滿或 TTL 到期不能改變已提交資料。
- [ ] Task 3.4：在 `app.maintenance` 增加可重跑的 cleanup 子命令及操作說明，依非 active 狀態／TTL 清理。
  與 commit 透過 transaction 協調；記錄數量及密文 bytes，不記錄明文資訊。
  部署操作明確安排至少每日執行，服務在 prepare 前也會清理已到期 reservation，避免額度永久卡住。
- [ ] Task 3.5：設定 nginx 各路徑 body limits 與 no-store，維持 `/api/` Service Worker network-only。
  各路徑設 client_max_body_size、limit_req、limit_conn 與串流 proxy_request_buffering off，不能全站放大。
  GET 固定 octet-stream／opaque attachment 名稱、no-store、nosniff 與 CSP sandbox，不含原始檔名。
  增加 snapshot／challenge／傳輸／batch 的共享 owner、session、IP 與 byte 限流及只含 ID／bucket 大小的 AuditAction。
- [ ] Task 3.6：測試缺失／偽造 Content-Length、超限 chunk、並行 quota reservation、上傳中斷、
  空檔、padding、retired、cleanup／commit 競態、永久刪除與全域存滿；ASGI receive spy 證明未認證時未讀 body。
  測試 receipt／payload TTL、audit 無秘密、429 後續作、真 nginx 及多 worker 共享限制。

**Deliverables**：有限資源的 binary API、可重跑清理、proxy 配置與安全測試。
**Acceptance**：AC-07、AC-09、AC-13、AC-14；AC-18 的部署設定部分。

### Phase 4: 瀏覽器格式、加密與遷移

- [ ] Task 4.1：新增 credential v2、template v2、collection 及 attachment manifest parsers。
  區分未知版本與損毀，不把未識別的 magic／版本降級成 legacy。
- [ ] Task 4.2：附件每次新增／替換產生新 UUID、金鑰及 IV，固定 AAD canonicalization；
  新 credential v3／collection v2 各有不同 OAEP label，附件 v2 有 4 KiB padding；保留 KDF v2。
  實作 KEK 保護的 P-256 key bundle／來源簽章，先驗 signed state／密文雜湊才解密。
- [ ] Task 4.3：新增檔案讀取、密文雜湊、完整 tag 驗證及安全下載 helpers；驗證前不建立 Blob URL。
  畫面與下載名稱都清理控制／雙向字元，先呈現明文副本提示；壞簽章或未知來源不可下載。保持原始 bytes。
- [ ] Task 4.4：以 vault session generation 封鎖遲到的選檔／crypto／fetch 結果；取消與上鎖清理 input、
  明文參照及 Blob URL，不將檔案持久化到瀏覽器儲存。
- [ ] Task 4.5：legacy credential adapter 保留 metadata、字串內容及順序，預設保守遮蔽。
  Template v1 轉換顯示 defaultValue 移除差異；只有明確保存才寫回。
  Legacy 來源標示未驗證，不能背景自動簽署；正式 v1 盤點證明後才可移除 runtime reader，未知資料不 fallback。
- [ ] Task 4.6：改寫 `credentialService` 保存後的驗證處理：使用 receipt／revision／batch status，
  移除更新驗證失敗時無條件回寫舊密文的方式；衝突提供保留本機編輯內容的重試。
- [ ] Task 4.7：加入 byte round-trip、empty file、tag／AAD 置換、跨紀錄重綁、鎖定 race、legacy fixtures 及未知格式測試。

**Deliverables**：不洩漏秘密的瀏覽器 helpers、向後讀取能力與可驗證的安全保存。
**Acceptance**：AC-02、AC-04、AC-05、AC-08、AC-10、AC-12、AC-17。

### Phase 5: Section、template 與檔案欄位 UI

- [ ] Task 5.1：重構 CredentialForm／Detail，以 section／field ID 管理新增、刪除、排序與遮蔽。
  支援 notes-only、file-only 紀錄，重複 label 不覆寫值，秘密遮蔽不再靠名稱猜測。
- [ ] Task 5.2：TemplateManager／Selector 支援 section、repeatable／maxInstances、五種型別與適用 validation。
  Template schema v2 拒絕值與 defaults，實例變更不回寫 template。
- [ ] Task 5.3：檔案欄位呈現選取、取消、上傳、成功、失敗、重試、替換與下載狀態，
  顯示大小與配額，不產生預覽或呼叫外部內容服務。
- [ ] Task 5.4：沿用 `secretFieldProps`／`privateFieldProps`，以鍵盤可操作的 controls 提供標籤、
  明確錯誤及可辨識的檔案／秘密顯示；鎖定後卸載所有顯示明文的視窗。
- [ ] Task 5.5：建立 Apple API／signing／profile、Android keystore、Windows signing、
  GCP OAuth／service account、Cloudflare token、GenAI key 的合成案例與通用模板。
  外部管理的私鑰附件為可選，不把 provider 帳號／project 寫死在模板。
- [ ] Task 5.6：更新 template storage、sync 與 export/import 的版本與相容性測試，
  涵蓋 duplicate IDs、repeatable instances、required／validation、未知欄位及備份類型混淆。
  竄改 template type／isSecret 不影響值欄位的 secretFieldProps，包含所有 list／multiline editors。

**Deliverables**：可用的結構化紀錄／template UI 及六種情境驗證。
**Acceptance**：AC-01、AC-02、AC-03、AC-04、AC-08；AC-17 的 template 部分。

### Phase 6: 加密集合與紀錄關聯

- [ ] Task 6.1：建立 collection service／UI，瀏覽器解密 parent／membership，三層上限與 cycle 檢查基於完整快照。
  移動依 vault_revision 與 signed state 提交；先驗狀態再顯示／過濾，避免未驗證 tombstone 隱藏資料。
- [ ] Task 6.2：集合名稱與路徑只存在記憶體／密文；改名不改 credential／field／attachment IDs。
  原有 category 原樣保留，轉集合是使用者操作，不以 `/` 字串自動推測私人樹狀結構。
- [ ] Task 6.3：集合刪除使用 tombstone；子集合以根層顯示、紀錄以未分類顯示。
  完整載入前不錯判 missing，非法／失效圖不隱藏紀錄，也不自動大批保存。
- [ ] Task 6.4：加入 owner-scoped 關聯選擇及導航、失效目標提示與去重，
  關聯不繼承權限、不觸發遞迴解密或複製秘密。
- [ ] Task 6.5：清單／搜尋使用 metadata snapshot 完整分頁，移除只取得預設第一頁的假全量行為。
  驗證瀏覽、搜尋及集合切換均不載入附件 BLOB。
- [ ] Task 6.6：測試 cycle、超深、同名集合、並行移動、集合 tombstone、失效參照、
  刪除關聯目標及 1,000 筆搜尋 fixture。

**Deliverables**：私密的集合導航與關聯能力，保留既有紀錄可見性。
**Acceptance**：AC-06、AC-11、AC-12。

### Phase 7: V2 完整備份與還原

- [ ] Task 7.1：實作 STORE-only 容器、header／manifest 加密及 schema validation，
  拒絕未知 KDF／版本、duplicate entries、路徑、額外檔案、壓縮及超限。
- [ ] Task 7.2：匯出完整含 revoked 的一致快照，逐檔驗證密文雜湊／GCM 並寫入容器；
  不能依賴畫面 cache，先以 bundle 信任根驗來源簽章／signed state，manifest 保存來源簽章／公鑰及 legacy provenance；
  不輸出全量附件 Base64，完成前重查整體 revision。
- [ ] Task 7.3：還原 preflight 驗證所有 entries 及配額，然後配置新 ID、重建集合／關聯，
  逐檔產生新金鑰／IV／padding 並依新 AAD 加密，以目標 bundle 已驗證 RSA 公鑰及簽章金鑰重建 signed state；
  不重新信任 API 公鑰。分筆 stage metadata，所有資料以同一 batch 提交。
- [ ] Task 7.4：保留來源 status／expiry 與加密 provenance；無法映射的關聯保留為失效來源資訊。
  失敗取消自己的 batch，不留下可見的半套紀錄，不改既有資料。
- [ ] Task 7.5：保留 credential backup v1 reader，與 template export 用 type 明確區分。
  備份 UI 顯示來源可信程度、完整性及限制；新密碼至少 12 字元，提供至少 128-bit CSPRNG 復原秘密。
  舊短密碼備份可讀，legacy provenance 不因新簽章消失；缺檔、來源更動、超限或取消均不顯示成功。
- [ ] Task 7.6：在不同帳號／新金鑰對中完成 full round-trip，比較原始附件 bytes、欄位、群組、狀態與關係。
  涵蓋錯誤密碼、容器損毀、超限、備份時刪檔、上鎖與提交網路回應遺失。

**Deliverables**：獨立於來源帳號私鑰的完整備份與原子還原。
**Acceptance**：AC-08、AC-12、AC-15、AC-16、AC-17。

### Phase 8: 獨立審閱、文件與發布驗證

- [ ] Task 8.1：執行完整 backend／frontend checks，對 release 版本完成獨立安全審閱，
  記錄程式碼作者、審閱者、發現與解決狀態。無獨立審閱不得宣稱已通過。
- [ ] Task 8.2：實際 Chrome／Firefox／Edge 驗證選檔、下載、鎖定、quota 與完整還原；
  使用 1,000 筆紀錄及 24 個 10 MiB 附件，量測時間、記憶體與清單請求數。
- [ ] Task 8.3：Docker／nginx 實測 request size、chunked upload、no-store、CSP 及 SW；
  在 NAS 上驗證 SQLite BLOB／WAL 成長、並行上傳、snapshot 還原及 cleanup。
- [ ] Task 8.4：更新架構、API、testing、安全、setup／deployment、使用者備份與 quickstart 文件。
  更新 release notes，清楚說明舊客戶端寫入封鎖及 downgrade 限制。
- [ ] Task 8.5：發布前建立並驗證 snapshot；成套發布 migration／backend／frontend，
  再以合成紀錄完成附件保存、上鎖、下載與跨帳號還原 smoke test。
- [ ] Task 8.6：只有所有 AC 有證據且獨立審閱完成，才將 SPEC 標為 Implemented、PLAN 標為 Completed。

**Deliverables**：測試／審閱證據、完整文件、可回復的發布步驟。
**Acceptance**：AC-01 至 AC-36 全部，含目前未執行的修正版獨立審閱、部署與 NAS 驗證。

## Files to Create/Modify

下表是實作目標，不表示檔案已建立；最終命名可依既有模組調整並同步本表。

| File | Action | Description |
|------|--------|-------------|
| `alembic/versions/` 新 migration | Create | 新增式 schema、初始 revisions 與安全 downgrade 檢查 |
| `app/models/credential.py`、`template.py`、`user.py`、`__init__.py` | Modify | 版本、relationships、owner constraints 與模型註冊 |
| `app/models/vault_state.py`、`vault_collection.py`、`vault_batch.py`、`credential_attachment.py` | Create | 整體 revision、集合密文、staging 及 BLOB lifecycle |
| `app/schemas/vault.py`、`attachment.py` | Create | Capabilities、snapshot、operations、receipt 及限制 |
| `app/schemas/credential.py`、`template.py` | Modify | 新寫入能力、版本及 template v2 |
| `app/services/vault.py`、`attachment.py` | Create | CAS、批次提交、quota、binary 接收及清理 |
| `app/services/credential.py`、`template.py` | Modify | 接入新寫入規則，避免舊路徑繞過 |
| `app/api/v1/vault.py`、`attachments.py` | Create | 新 API 與 owner／proof 保護 |
| `app/api/v1/credentials.py`、`templates.py`、`router.py` | Modify | 新路由、舊介面 gate 與 status mutation revision |
| `app/config.py`、`app/maintenance.py`、`.env.example` | Modify | owner／global 限制、free-space、cleanup／receipt retention |
| `app/db/session.py`、`app/core/rate_limit.py`、`app/models/audit_log.py` | Modify | 連線 PRAGMA／transaction、共享限流及 audit actions |
| `app/models/vault_capacity.py` | Create | 全域容量帳本 |
| `frontend/src/types/credential.ts`、`lib/credentialSchema.ts` | Create | Typed fields／sections／manifest 與 legacy adapters |
| `frontend/src/types/template.ts`、`types/index.ts` | Modify | Template v2、capabilities 與 API types |
| `frontend/src/lib/crypto.ts`、`attachmentCrypto.ts`、`collectionCrypto.ts` | Modify / Create | OAEP label、新 envelope 與 padding；key bundle 與 `recordSigning.ts` 已實作 |
| `frontend/src/lib/attachmentDownload.ts`、`vaultSession.ts` | Create | 安全下載、取消與 session generation |
| `frontend/src/services/vaultService.ts`、`attachmentService.ts` | Create | Batch／snapshot／binary clients |
| `frontend/src/services/credentialService.ts`、`templateService.ts` | Modify | CAS 保存、驗證與 capability gate |
| `frontend/src/hooks/useVaultLock.ts`、`useCredentialCrypto.ts`、`useVaultKey.ts` | Modify | 清理、非同步結果失效與明文生命週期 |
| `frontend/src/components/CredentialForm.tsx`、`CredentialDetail.tsx`、`AttachmentField.tsx` | Modify / Create | Section、型別化欄位及檔案狀態 |
| `frontend/src/components/TemplateManager.tsx`、`TemplateSelector.tsx`、`ExportImportDialog.tsx` | Modify | 新定義、轉換與 template 匯出匯入 |
| `frontend/src/components/CollectionTree.tsx`、`RelatedCredentials.tsx` | Create | 集合導航、選擇、關聯及失效提示 |
| `frontend/src/pages/CredentialsPage.tsx` | Modify | 全量 metadata 分頁、集合及不預載附件 |
| `frontend/src/lib/templateStorage.ts`、`templateExport.ts`、`data/templates.ts` | Modify | Storage／export 遷移及情境模板 |
| `frontend/src/lib/credentialBackup.ts`、`backupContainer.ts`、`components/CredentialBackupDialog.tsx` | Modify / Create | V2 容器、完整備份、preflight 與原子還原 |
| `frontend/nginx.conf`、`public/sw.js`、`package.json`、`package-lock.json` | Modify as needed | 上傳／cache 邊界及 ZIP dependency |
| `tests/unit/`、`tests/integration/`、`frontend/src/__tests__/` | Create / Modify | 下述 regression／安全案例；只用合成資料 |
| `docs/architecture.md`、`api.md`、`testing.md`、`security-guidelines.md`、`setup-guide.md`、`deployment.md`、`QUICKSTART.zh-TW.md` | Modify | 在實作同批更新實際行為與操作方法 |

## Technical Decisions

- 依 ADR-003／004 採 SQLite BLOB、可信 key bundle 與簽章；快照不含 BLOB，但包含所有驗證所需的 signed state。
- 集合 parent、membership 及關聯留在密文；前端驗證結構，整體 revision 協調誠實客戶端的並行操作。
- 同一 typed object 產生 credential 密文及公開的附件 ID 宣告，避免兩份獨立邏輯造成孤兒附件。
- 不沿用 `credentialService.update` 的無條件回滾。Storage verification 是機械檢查，不等於獨立安全審閱。
- V2 備份以加密 manifest 保護每檔金鑰及來源 AAD，附件保留密文；還原時產生新身分及重新加密。
- 沒有新增 listener；若後續實作改變服務或 port，先依 `docs/services.md` 的規則處理。

## Testing Strategy

### Unit / Component

- `credentialSchema.test.ts`：typed unions、ID／數量上限、無損 legacy conversion、未知內容不轉存。
- `attachmentCrypto.test.ts`、`collectionCrypto.test.ts`：byte round-trip、domain separation、空檔、nonce／key 更新及 AAD 置換。
- `credentialForm.test.tsx`、`attachmentField.test.tsx`：重複 section、同名欄位、file-only、取消、遮蔽及安全下載。
- `collectionTree.test.tsx`、`relatedCredentials.test.tsx`：三層、cycle、tombstone、完整載入與失效連結。
- `credentialBackup.test.ts`、`backupContainer.test.ts`：v1／v2、全量來源、cross-account remap、惡意 ZIP 及缺檔。
- 延伸 `vaultLock.test.tsx`、`credentialService.test.ts`、template 系列與 `inputProps.test.tsx`，驗證 race 與新欄位宣告。

### Backend Integration

- `test_api_vault.py`、`test_api_attachments.py`：owner／admin 隔離、proof、capability、binary limits、immutable IDs。
- `test_vault_transactions.py`：CAS、冪等 receipt、quota 原子保留、upload／abort／cleanup／commit 競態及可見性。
- Migration／maintenance tests：既有密文不變、snapshot 一致、user／credential cascade、cleanup 可重跑及 downgrade 拒絕遺失資料。
- 延伸 `test_api_credentials.py`、`test_api_templates.py`：所有 legacy write／import／sync paths 的新格式保護。

### Required Commands

從實際 manifests／CI 確認的實作完成檢查如下。既有服務修補已執行本地回歸，
新附件／簽章格式的測試仍待實作；兩者不能混為完成證據。

```powershell
# Repository root
pytest
ruff check .
ruff format --check .
mypy app/ --ignore-missing-imports

# frontend/ working directory
npm run test:run
npm run lint
npm run build
```

若修改依賴或 Docker／nginx，另依 CI 執行 lockfile／audit／image build，並檢查實際 HTTP 回應。
不得以靜態設定檔比對代替執行中 nginx 路徑優先順序、body limit、CSP／cache 標頭與 SW 驗證。

## Security Acceptance Mapping

| 驗收 | 主要實作階段與必要證據 |
|------|----------------------|
| AC-19、AC-20 | Phase 0／4：跨用途拒絕、私鑰導出、公鑰替換失敗及成套部署 |
| AC-21 | Phase 1／4／6／7：只有公鑰的偽造、signed state 篡改及 legacy provenance |
| AC-22 | Phase 3／8：ASGI receive／真 nginx 在 body 讀取前拒絕，串流／rate／conn 邊界 |
| AC-23、AC-24、AC-25 | Phase 2／8：真連線 commit failure、FK 反向測試、CAS／quota 與 PRAGMA |
| AC-26 | Phase 0／7：12 字元門檻、舊備份可讀、CSPRNG 復原秘密 |
| AC-27 | Phase 0／7：無狀態 nonce、多分頁、登出撤銷與長時間還原 |
| AC-28、AC-29 | Phase 2／3／8：全域／owner 容量、payload 清除、receipt TTL 與磁碟故障 |
| AC-30 | Phase 3／8：audit 無秘密、共享限流及 429 續作 |
| AC-31 | Phase 1／4／7：padding bucket／原始大小／邊界與恢復 bytes |
| AC-32、AC-33 | Phase 1／5／8：ZIP／CSP 實測及惡意 template 的輸入保護 |
| AC-34 | Phase 0／4／7：正式 envelope 盤點、無盲目 fallback、來源狀態保留 |
| AC-35、AC-36 | Phase 3／5／8：下載 headers、檔名顯示清理及明文副本提示 |

## External Review Resolution

此表追蹤使用者轉交的 16 項審閱。原稿審閱具有獨立性，但不是對本次新程式碼或修正版的獨立核准。
本地回歸測試不等於已部署，以下未完成的前置條件保持 gate 關閉。利用細節／PoC 不寫入公開研究。

| 項次 | 處置 | 狀態／驗收 |
|------|------|-----------|
| 1 | 既有 proof label、TTL／長度及鎖定 race 修補；未來 proof 改 nonce 簽章 | 本地修補已測，待獨立驗證／部署；AC-19 |
| 2 | 由 PKCS8 導出 RSA 公鑰，拒絕 API 不符值；還原沿用可信金鑰 | 本地修補已測，待獨立驗證／部署；AC-20 |
| 3 | ADR-004 必要簽章與 signed state、一次性升級與 legacy-unverified | 既有 credential 已實作並有測試，待獨立重審／部署；集合與附件隨格式實作；AC-21 |
| 4 | 原始 Request 先驗證再讀，分筆 operation、nginx 分路徑限額／限流 | 設計已修訂、尚未實作；AC-22 |
| 5 | 明確 commit、FK preflight／ON、WAL／FULL、條件式 CAS／quota | 設計已修訂、尚未實作；AC-23～25 |
| 6 | 新備份至少 12 字元及 CSPRNG 復原秘密，舊短密碼仍可讀 | 本地修補已測，v2 待實作；AC-26 |
| 7 | Proof v2 無狀態 nonce，新 challenge 不使 proof 失效；不用多槽 | 已實作並有測試，待獨立重審／部署；AC-27 |
| 8 | 全域 logical quota、metadata／帳號建立計額、磁碟保留 | 設計已修訂、尚未實作；AC-28 |
| 9 | Commit 同步清 payload、receipt TTL、secure_delete 限制 | 設計已修訂、尚未實作；AC-29 |
| 10 | AuditAction、snapshot／下載／challenge 的共享限流與 bytes 限額 | 設計已修訂、尚未實作；AC-30 |
| 11 | 4 KiB padding，接受 bucket／數量／時間洩漏 | ADR-004 已明定、尚未實作；AC-31 |
| 12 | ZIP 維持現有 CSP，停動態 worker；實測選型而非憑記憶 | 設計已修訂、尚未選型；AC-32 |
| 13 | 所有值無條件 secretFieldProps，惡意 template 回歸測試 | 現況已有保護，新 editors 仍必須覆蓋；AC-33 |
| 14 | 未知版本與未簽章紀錄到不了 v1 解析；盤點後才移除 v1 reader | Fallback 已封閉，盤點未做，v1 reader 保留；AC-34 |
| 15 | Binary GET 的 octet-stream／attachment／no-store／nosniff／sandbox | 設計已修訂、附件 API 尚未實作；AC-35 |
| 16 | 顯示及下載檔名均清理雙向字元，下載前提示明文副本 | 設計已修訂、附件 UI 尚未實作；AC-36 |

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| 舊 client 遺失新格式 | High | 全路徑 capability gate、未知型別 fail closed、雙版本 fixtures |
| Metadata 與附件部分保存 | High | Staging、原子 commit、冪等 receipt、保留舊附件至提交後 |
| 兩個頁面互相覆寫／集合形成循環 | High | 整體及 row CAS；衝突重新取快照，不靜默覆寫 |
| 上鎖後遲到結果洩漏明文 | High | Session generation、abort、Blob URL 清理與 race tests |
| 備份可讀卻缺附件或依賴舊金鑰 | High | 自包含 manifest、全量來源、所有檔案驗證、跨帳號實測 |
| 配額競態、ZIP 膨脹及記憶體耗盡 | High | 預留額度、實際串流計數、STORE-only、bounded metadata／entry／檔案處理 |
| BLOB／WAL 使 NAS 空間增加 | Medium | 先量測、低預設配額、監測 DB 成長、定期清理，不承諾刪檔即縮 DB |
| 端點遭入侵或下載副本殘留 | High | 記錄安全邊界、維持 CSP 與依賴檢查；不宣稱 E2EE 能收回本機副本 |

## Release / Rollback

既有服務熱修補：不改既有資料格式、不需重加密或 schema migration；以修補 regression、獨立驗證及前後端成套部署為驗收，
不等待附件新功能的全部 AC。部署後檢查來源版本、瀏覽器重載、解鎖、proof 及既有資料讀寫；未部署不得宣稱修復線上服務。

新功能發布前：通過全部 AC、完成獨立審閱、驗證 snapshot 可還原，並記錄舊／新版服務及資料格式。
發布時：後端／前端／migration 成套，舊頁面無法寫入，合成資料 smoke test 通過才開放使用。
未曾有 v2 寫入時可依已驗證 migration 還原程序處理；已有 v2 資料時先保留完整 v2 備份，
採相容修復版，或在明確揭露資料損失且取得授權後還原整份 pre-upgrade snapshot。
不自動刪附件、清 DB 或執行破壞性 downgrade；發布／還原執行屬後續明確工作。

## Progress Log

| Date | Update |
|------|--------|
| 2026-11-05 | 建立原稿，收到外部設計審閱後新增 ADR-004／Phase 0、逐項處置與 AC-19～36；既有服務修補有本地測試，修正版尚未獨立驗證或部署 |
| 2026-11-05 | 審閱 `97224aa`／`7c7dd05` 後修正：公鑰不符不再顯示成密碼錯誤、未知 blob 版本不落入 v1、自動上鎖清 proof；設計改為強制升級與無狀態 proof。實作 key bundle、紀錄簽章（含 status 與 revision）、proof v1／v2 及一次性升級，寫入改為條件式 CAS 並在回應前明確 commit |
| 2026-11-05 | 獨立審查後修正：只簽使用者看過的紀錄、重讀比對完整簽章狀態、回滾標記改用導出公鑰為鍵、proof v1 不存每次狀態且只限升級、解密內容檢查形狀、upgrade／setup 條件式寫入。第二輪再修：migration 不重建表、proof v1 混入每位使用者金鑰、失敗後重新載入清單，並補 migration 與頁面測試。端到端以暫存資料庫驗證；未部署。Setup 的 step-up 待決定 |
| 2026-11-05 | 既有服務修補本地驗證：pytest 242 passed（Windows private tmp 需完整使用者權限）、Vitest 219 passed（maxWorkers=2）、ruff／mypy／ESLint／production build 通過。文件 78 個本機連結、21 個 FR、36 個 AC 與 Phase 0～8 檢查通過；不等於新格式實作或部署驗收 |
| 2026-11-05 | 完成 Task 0.4c：vault setup 要求該 session 10 分鐘內實際登入，token 帶 `auth_time`，刷新時保留不重算；舊 token 一律拒絕。獨立審查後再修：`/auth/verify-password` 加限流、閒置後的登出會先刷新再登出、登入頁加管理員密碼登入連結。pytest 328、Vitest 350 通過，另以三種故意改壞確認測試會失敗 |

---

*Created: 2026-11-05*
*Last updated: 2026-11-05*
