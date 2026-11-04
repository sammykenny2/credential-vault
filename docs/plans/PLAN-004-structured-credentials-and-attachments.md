# PLAN-004: 結構化憑證、集合與加密附件

> Implementation Plan

## Metadata

| Field | Value |
|-------|-------|
| **Status** | Draft；尚未開始實作 |
| **Owner** | 專案維護者 |
| **Assigned To** | 實作時指定 |
| **Reviewer** | 待指定獨立審閱者；作者不得自行審查其程式碼 |
| **Baseline** | `2d41d37`；2026-11-05 |

## Related Spec

[SPEC-004: 結構化憑證、集合與加密附件](../specs/SPEC-004-structured-credentials-and-attachments.md)。
架構理由見 [ADR-003](../decisions/003-structured-credentials-and-attachments.md)。

## Overview

先固定資料格式、限制與測試向量，再實作保留資料的 migration、revision／batch、
瀏覽器加密與欄位 UI，最後完成集合／關聯、備份還原及真實部署驗證。
每個階段以合成資料驗證，不接觸真實秘密。中間 commit 可供審閱，但功能在全部安全與備份條件
完成前不發版，避免形成只能保存、無法完整還原的附件功能。

本文件完成的是規劃。下列實作及驗收工作均未完成；本次不執行 Alembic、不修改產品版本、不部署。

## Implementation Phases

### Phase 1: 固定格式、能力與限制

- [ ] Task 1.1：將 SPEC-004 的型別整理為 TypeScript discriminated unions 與 runtime parsers，
  分開 legacy read adapter、新格式 writer 與 unknown-version errors。
- [ ] Task 1.2：定義模板 v2、collection envelope、附件 envelope、AAD、batch JSON 與 backup v2 header／manifest。
  為 UUID 大小寫、UTF-8、長度邊界、secret flag、未知型別及重複 ID 建立測試向量。
- [ ] Task 1.3：明確定義 capabilities、426／409 等 error codes、row revisions、整體 revision 及冪等 receipt。
  列出現有 credential／template 所有 write、sync、import 路徑，確保沒有 legacy bypass。
- [ ] Task 1.4：選定有維護的 ZIP reader/writer，驗證 STORE-only、逐 entry 處理、duplicate-entry 偵測、
  不需 File System Access API，以及授權、bundle 大小與目前瀏覽器相容性。
  只增加完成需求必要的依賴，鎖定於 npm lockfile 並執行依賴稽核。
- [ ] Task 1.5：以小型 prototype 驗證 10 MiB 單檔與 240 MiB 附件備份的記憶體模型。
  明確限制同時接收檔案／batch 的數量，並將所有可設定限制納入 capabilities。
- [ ] Task 1.6：在正式實作前取得格式與安全設計的獨立審閱，記錄意見及解決結果。

**Deliverables**：可實作的型別／協定、合成測試向量、dependency 選擇及負載紀錄。
**Gate**：格式、ZIP 行為與記憶體限制尚未驗證時，不進入備份／附件格式實作。

### Phase 2: 新增式 migration 與寫入一致性

- [ ] Task 2.1：新增 `credentials.revision`、`content_schema_version`；舊 row 設為 1。
  Template 定義另有 schema version，保留現有 `sync_version` 語意。
- [ ] Task 2.2：新增 `vault_state`、`vault_collections`、`vault_batches`、`credential_attachments`，
  及 owner、狀態、大小、過期時間與必要索引／FK／unique／check constraints。
  Staged 的預定 credential ID 與 committed FK 分開，支援尚未可見的新紀錄。
- [ ] Task 2.3：實作 vault service 的 prepare／commit／abort／status，所有提交以整體及 row revision CAS。
  所有 metadata 操作與附件狀態在同一 transaction 提交，並防止兩次 commit／commit-vs-abort 競態。
- [ ] Task 2.4：原子保留與釋放 quota；重複 prepare／upload／commit 不重複占額。
  不將明文檔名、MIME、金鑰、parent、membership 或關聯放入外部 operation metadata。
- [ ] Task 2.5：既有 create／update／import／revoke／delete 接入 protocol、proof、revision 及附件一致性規則。
  現有 template write／sync／import 也檢查 schema 能力；不能由舊欄位 schema 忽略新內容後存回。
- [ ] Task 2.6：實作全量 snapshot cursor，以一致 revision 取得 metadata；分頁中有提交則回衝突。
  同時涵蓋 revoked 紀錄及集合 tombstone，不載入附件 BLOB。
- [ ] Task 2.7：migration 測試覆蓋既有密文未改、筆數未減、user cascade、跨 owner FK，及失敗 rollback。
  Down migration 在存在新版資料時拒絕破壞性刪除，說明 snapshot 還原路徑。

**Deliverables**：migration、批次寫入與讀取介面、owner／proof／capability 邊界及 integration tests。
**Acceptance**：AC-07、AC-09、AC-10、AC-17 的 backend 部分。

### Phase 3: 附件密文傳輸、配額與清理

- [ ] Task 3.1：新增 raw binary 上傳及 owner-scoped 下載；串流接收時計算實際 bytes／密文 SHA-256，
  同時檢查宣告長度、檔案上限及 reservation。錯誤時釋放 staged bytes，不洩漏秘密至錯誤訊息。
- [ ] Task 3.2：只接受 batch 中預先登記的附件 ID；禁止覆寫 immutable bytes、跨 credential 重用或讀取 pending bytes。
  已完成的相同 upload 可重試，不同內容回錯誤。
- [ ] Task 3.3：commit 檢查完整 active 附件集合、歸屬及大小，替換成功後才將舊附件標 retired。
  暫存上傳失敗、存滿或 TTL 到期不能改變已提交資料。
- [ ] Task 3.4：在 `app.maintenance` 增加可重跑的 cleanup 子命令及操作說明，依非 active 狀態／TTL 清理。
  與 commit 透過 transaction 協調；記錄數量及密文 bytes，不記錄明文資訊。
  部署操作明確安排至少每日執行，服務在 prepare 前也會清理已到期 reservation，避免額度永久卡住。
- [ ] Task 3.5：設定 nginx 各路徑 body limits 與 no-store，維持 `/api/` Service Worker network-only。
  大型 JSON batch 及 binary 上傳使用各自合理上限，不全站無限制放大。
- [ ] Task 3.6：測試缺失／偽造 Content-Length、超限 chunk、並行 quota reservation、上傳中斷、
  空檔、部分 bytes、retired 下載、清理與 commit 競態、永久刪除附件及存滿時的錯誤。

**Deliverables**：有限資源的 binary API、可重跑清理、proxy 配置與安全測試。
**Acceptance**：AC-07、AC-09、AC-13、AC-14；AC-18 的部署設定部分。

### Phase 4: 瀏覽器格式、加密與遷移

- [ ] Task 4.1：新增 credential v2、template v2、collection 及 attachment manifest parsers。
  區分未知版本與損毀，不把未識別的 magic／版本降級成 legacy。
- [ ] Task 4.2：附件每次新增／替換產生新 UUID、金鑰及 IV，固定 AAD canonicalization；
  collection 使用獨立 domain envelope，保留 credential blob v2 與 KDF v2。
- [ ] Task 4.3：新增檔案讀取、密文雜湊、完整 tag 驗證及安全下載 helpers；驗證前不建立 Blob URL。
  對惡意檔名做安全下載名稱處理，保持原始 bytes。
- [ ] Task 4.4：以 vault session generation 封鎖遲到的選檔／crypto／fetch 結果；取消與上鎖清理 input、
  明文參照及 Blob URL，不將檔案持久化到瀏覽器儲存。
- [ ] Task 4.5：legacy credential adapter 保留 metadata、字串內容及順序，預設保守遮蔽。
  Template v1 轉換顯示 defaultValue 移除差異；只有明確保存才寫回。
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

**Deliverables**：可用的結構化紀錄／template UI 及六種情境驗證。
**Acceptance**：AC-01、AC-02、AC-03、AC-04、AC-08；AC-17 的 template 部分。

### Phase 6: 加密集合與紀錄關聯

- [ ] Task 6.1：建立 collection service／UI，瀏覽器解密 parent／membership，三層上限與 cycle 檢查基於完整快照。
  移動依 `vault_revision` 提交，避免兩個頁面依不同圖各自保存。
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
  不能依賴畫面 decrypted cache，不輸出全量附件 Base64，完成前重查整體 revision。
- [ ] Task 7.3：還原 preflight 驗證所有 entries 及配額，然後配置新 ID、重建集合／關聯，
  逐檔產生新金鑰／IV 並依新 AAD 加密，以同一 staged batch 提交。
- [ ] Task 7.4：保留來源 status／expiry 與加密 provenance；無法映射的關聯保留為失效來源資訊。
  失敗取消自己的 batch，不留下可見的半套紀錄，不改既有資料。
- [ ] Task 7.5：保留 credential backup v1 reader，與 template export 用 type 明確區分。
  備份 UI 顯示完整性及限制，缺檔、來源更動、超限或取消均不顯示成功。
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
**Acceptance**：AC-01 至 AC-18 全部，含目前未執行的部署與 NAS 驗證。

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
| `app/config.py`、`app/maintenance.py`、`.env.example` | Modify | 共用限制、可重跑 cleanup 及操作參數 |
| `frontend/src/types/credential.ts`、`lib/credentialSchema.ts` | Create | Typed fields／sections／manifest 與 legacy adapters |
| `frontend/src/types/template.ts`、`types/index.ts` | Modify | Template v2、capabilities 與 API types |
| `frontend/src/lib/crypto.ts`、`attachmentCrypto.ts`、`collectionCrypto.ts` | Modify / Create | 既有 envelope 嚴格解析及獨立加密 domain |
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

- 依 ADR-003 採 SQLite BLOB；所有清單／snapshot 查詢顯式排除附件內容。
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

從實際 manifests／CI 確認的實作完成檢查如下；本次僅編寫文件，未執行這些產品測試。

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

發布前：通過全部 AC、完成獨立審閱、驗證 snapshot 可還原，並記錄舊／新版服務及資料格式。
發布時：後端／前端／migration 成套，舊頁面無法寫入，合成資料 smoke test 通過才開放使用。
未曾有 v2 寫入時可依已驗證 migration 還原程序處理；已有 v2 資料時先保留完整 v2 備份，
採相容修復版，或在明確揭露資料損失且取得授權後還原整份 pre-upgrade snapshot。
不自動刪附件、清 DB 或執行破壞性 downgrade；發布／還原執行屬後續明確工作。

## Progress Log

| Date | Update |
|------|--------|
| 2026-11-05 | 建立 ADR／SPEC／PLAN 草案與一手來源研究；尚未開始實作、獨立審閱及產品測試 |

---

*Created: 2026-11-05*
*Last updated: 2026-11-05*
