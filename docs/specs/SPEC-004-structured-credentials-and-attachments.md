# SPEC-004: 結構化憑證、集合與加密附件

> Feature Specification

## Metadata

| Field | Value |
|-------|-------|
| **Status** | Draft；尚未實作 |
| **Owner** | 專案維護者 |
| **Reviewer** | 待指定獨立審閱者 |
| **Decision** | [ADR-003](../decisions/003-structured-credentials-and-attachments.md)（Proposed） |
| **Plan** | [PLAN-004](../plans/PLAN-004-structured-credentials-and-attachments.md)（Draft） |
| **Baseline** | `2d41d37`；2026-11-05 |

## Summary

讓使用者透過 template 或自訂欄位，以一層可重複 section 保存文字、秘密、清單與檔案；
以加密集合階層及紀錄關聯整理開發者與雲端憑證。附件於瀏覽器加密，後端保存獨立密文，
並支援有 revision 的安全保存、非破壞性資料遷移及包含附件的完整備份還原。

本規格描述預期的新行為，不宣告現有程式已符合。需求與驗收 ID 供實作及測試追蹤。

## Goals

- 同筆保存必須一起使用的檔案、密碼與識別資訊，保留原始檔案 bytes。
- 支援 project／environment 集合、一層可重複 section，以及獨立紀錄間的關聯。
- 保留 zero-knowledge invariant，附件按需載入，鎖定後不重新出現明文。
- 並行修改、上傳失敗與還原失敗不覆寫其他資料，也不產生假成功。
- 新舊格式有明確識別，保留現有資料與 v1 備份的讀取能力。

## Non-Goals

- 任意深度的 section、通用 JSON 編輯器、廠商 JSON／憑證／profile 解析器。
- 檔案預覽、解壓縮、執行、安裝、內容掃毒、第三方秘密分析或公開下載連結。
- 分享、集合 ACL、權限繼承、完整版本歷史、秘密注入、自動簽署與外部金鑰輪替。
- 更換認證方式、vault KDF 或既有 credential RSA／AES 金鑰階層。
- 安全抹除保證、解鎖中端點遭入侵的防護，以及惡意伺服器回放的完整偵測。

## User Stories

| 情境 | 使用者應能完成 |
|------|----------------|
| Apple Developer | 分筆保存 API key、簽署憑證與 profile，將 `.p8`／私鑰備份和相關識別資訊成組，關聯共用材料 |
| Android Developer | 將 keystore 與 store password 成組，重複建立 alias／key password／fingerprint 群組，區分 upload 與 app signing 身分 |
| Windows signing | 保存憑證、可選的金鑰檔案或外部 provider／container 位置，以及 timestamp 設定 |
| GCP | 在 project／environment 下分筆保存 API key、OAuth client、service-account key；保存 JSON 原檔與 redirect URI 清單 |
| Cloudflare | 每個 token 各自成筆，透過重複規則群組配對權限與適用資源 |
| GenAI | 保存 provider、endpoint、project／workspace、用途與 API key，區分環境及獨立輪替的 key |

上述結構是本專案的整理方式，不承諾驗證外部服務權限或實際簽署能力。
官方背景與設計推論見 [研究紀錄](../research/2026-11-05-structured-vault-use-cases.md)。

## Requirements

### Functional Requirements

| ID | 必要行為 |
|----|----------|
| FR-01 | Template 與自訂紀錄都支援具穩定 ID 的 section、型別化欄位、排序及明確 `isSecret` |
| FR-02 | Template 可定義重複 section；每個實例及欄位有獨立 ID，欄位名稱可跨實例重複而不覆寫 |
| FR-03 | 支援三層集合、一個主要集合及未分類檢視；集合改名、移動不改變憑證或附件 ID |
| FR-04 | 關聯同 owner 的多筆紀錄，支援失效關聯顯示，不複製秘密、不自動遞迴解密目標 |
| FR-05 | 檔案欄位支援選檔、取消、下載、替換及移除；不要求紀錄必須有文字欄位才能保存 |
| FR-06 | 附件 bytes、檔名、MIME 與解密材料在瀏覽器處理；清單及搜尋不下載附件內容 |
| FR-07 | Metadata 與附件以 staged batch 提交，具 revision、冪等重試及完整性驗證 |
| FR-08 | 所有 vault 寫入檢查能力版本；新寫入／上傳及破壞性操作要求 vault proof，所有存取以 owner 隔離 |
| FR-09 | 限制請求、檔案、使用者配額、實例數與匯入大小；未提交及 retired 附件受配額及清理規則管理 |
| FR-10 | 上鎖、登出、取消或卸載時終止明文工作；過期的非同步結果不得重填 UI 或發起下載 |
| FR-11 | 完整備份包含所有 active／revoked 紀錄、有效集合、關聯與被引用附件，跨帳號不依賴來源私鑰即可還原 |
| FR-12 | 既有密文與 v1 備份可讀，舊 template 可轉換；不清空資料庫、不默默移除未知內容 |
| FR-13 | 刪除集合不刪憑證、附件或子集合；永久刪除憑證明確處理其附件，兩種操作在 UI 區分 |
| FR-14 | 新增／調整六種情境的 template，並更新使用說明、API、schema、備份及安全文件 |

### Non-Functional Requirements

- **Security**：秘密及其明文雜湊不得進入後端、log、URL、analytics、localStorage、sessionStorage、IndexedDB 或 Cache Storage。
  template 定義仍是伺服器可讀資料；其中只允許通用欄位定義。
- **Integrity**：所有解密結果先做 runtime validation；未知版本／型別、重複 ID、失效檔案參照及型別不符都不能轉存成簡化內容。
- **Performance**：清單流量只包含 metadata 密文；同時最多處理一個檔案的明文，備份不組成全量附件 Base64／明文字串。
  發布驗證使用 1,000 筆紀錄、24 個 10 MiB 附件，並記錄瀏覽器、硬體、記憶體及時間結果。
- **Reliability**：失敗保留既有已提交資料；可重試操作必須先查詢既有 batch 結果。所有頁面取完才可稱完整快照。
- **Compatibility**：驗證目前 Chrome、Firefox、Edge 的 Web Crypto、選檔與下載；不把 File System Access API 當作必要前提。
- **Operations**：沿用現有 listener／Docker Compose，不新增外部服務；環境設定提供限制值，UI 從 capabilities 取得相同限制。

## Design Overview

```text
Collection（最多三層）
  Credential（各自有到期／狀態與 revision）
    Section instance（可重複，不能再含 section）
      Field：text / secret / multiline / list / file
    Attachment manifest ──> 按需取得的附件密文
    Related credential IDs ──> 其他獨立紀錄
```

### 1. 版本與資料模型

| 層次 | 新版識別 | 相容規則 |
|------|----------|----------|
| DB schema | 新 Alembic revision | 新增式變更；不改寫舊密文 |
| Vault 寫入協定 | `X-Vault-Protocol: 2` | 缺少或不支援時拒絕 vault 寫入，回 426 |
| Credential 內容 | `schemaVersion: 2` | 無版本的既有文字 map 視為 v1，只在瀏覽器轉換 |
| Credential 加密 envelope | 既有 crypto blob v2 | v1 保持可讀；所有新寫入使用現有 ID-bound v2 |
| Collection 內容／envelope | 內容 v1／collection envelope v1 | 獨立 domain；不得套用 credential 的 legacy fallback |
| Template | 定義 `schemaVersion: 2`、storage v2、export v2 | `sync_version` 繼續代表 optimistic locking；不兼作格式版本 |
| Attachment envelope | v1 | 格式不支援就拒絕，不試猜其他格式 |
| Credential backup | `.cvault` v2 | 可讀 v1；v2 不輸出成會漏附件的 v1 |

憑證解密內容的核心結構如下；所有 UUID 為小寫標準 UUID，每個實例 ID 在其紀錄內唯一。

```typescript
type FieldType = 'text' | 'secret' | 'multiline' | 'list' | 'file'

interface FieldBase {
  id: string
  definitionId?: string
  label: string
  isSecret: boolean
}

type StoredField = FieldBase & (
  | { type: 'text' | 'secret' | 'multiline'; value: string }
  | { type: 'list'; value: string[] }
  | { type: 'file'; value: string[] } // 附件 ID，不是檔名或檔案 bytes
)

interface SectionInstance {
  id: string
  definitionId?: string
  label: string
  fields: StoredField[]
}

interface AttachmentManifestEntry {
  id: string
  fieldId: string
  fileName: string
  mimeType: string
  byteLength: number
  keyBase64: string // 32 bytes 金鑰，僅存在於此加密內容
  encryptionVersion: 1
  ciphertextSha256: string
}

interface CredentialDataV2 {
  schemaVersion: 2
  name: string
  description?: string
  website_url?: string
  category?: string // 保留舊分類文字；不當作集合路徑
  notes?: string
  collectionId: string | null
  sections: SectionInstance[]
  attachments: AttachmentManifestEntry[]
  relatedCredentialIds: string[]
  unresolvedRelatedIds?: string[] // 還原時無法對應的來源 ID，不當作本帳號目標
  provenance?: { sourceCreatedAt: string; sourceUpdatedAt: string; restoredAt: string }
}
```

- `secret` 與 `file` 的 `isSecret` 必須為 true；其餘型別可由使用者選擇遮蔽。所有值一律加密。
- 空字串、前後空白、換行與檔案 bytes 保留原樣；欄位 label 的正規化不能改寫值。
- 附件 ID 與欄位參照必須雙向對應且各只屬於一個 file 欄位；複製含附件欄位要產生新 ID／金鑰並重新加密。
- 同筆內改名、重排或移動 section 保留欄位 ID；跨紀錄移動附件需要新的 AAD 與加密。
- 沒有 template 的臨時欄位及 section 與 template 產生的實例具有相同能力。
- Template v2 是 `sections[]`，每個定義有 `id`、`label`、`repeatable`、`maxInstances` 與 `fields[]`。
  欄位定義有 ID、label、type、isSecret、required、placeholder 及適用的 validation／選檔提示。
  實例 `definitionId` 指向來源定義；修改 template 不追溯改寫已保存紀錄。
- Template v2 禁止 `defaultValue`、實際值、附件與金鑰；不把當前紀錄內容複製進 template。

### 2. 集合、關聯與刪除語意

集合解密內容為 `{ schemaVersion: 1, name, parentId: UUID | null }`。
其 row 只暴露 ID、owner、revision、內容版本、密文、tombstone 及時間。

新增或移動前，客戶端以完整 metadata 快照檢查同 owner 目標、三層上限及循環。
使用整體 revision 提交，衝突後重新取完整快照驗證。後端不讀取密文 parent／membership／relation。
已保存但不合法的圖要顯示可修復的未分類／根集合，不無限遞迴、不隱藏紀錄、不自動寫回。

集合刪除只寫 tombstone；子集合的失效 parent 視為 root，憑證的失效集合視為未分類。
下次明確編輯保存時正規化參照，不能透過顯示動作大量重寫資料。集合名稱不必唯一，操作以 ID 定位。
永久刪除憑證要求明確操作及 proof，刪除其 active／retired 附件並使相關 staged batch 提交失敗。
來源關聯顯示失效；不得跨 owner 搜尋目標或因連結不存在而刪來源。

### 3. 附件加密與安全下載

附件二進位 envelope 為 `ASCII("CVAF") | 0x01 | IV(12 bytes) | ciphertext || tag(16 bytes)`。
空檔合法，最小 envelope 為 33 bytes；驗證長度後才解析。附件金鑰只由 manifest 提供。
AAD 是以下固定陣列的 `JSON.stringify` 結果之 UTF-8 bytes，所有 ID 來自已驗證的憑證 manifest：

```json
["credential-vault/attachment", 1, "credentialId", "fieldId", "attachmentId"]
```

上述三個 ID 名稱表示對應的小寫 UUID 值，並非傳輸時的固定字串。
先比對密文 SHA-256，再驗證 GCM tag；全部成功才建立下載 Blob。
SHA-256 為密文雜湊，不能取代 GCM，亦不得改成明文雜湊送往伺服器。

Collection envelope 使用 `ASCII("CVCL") | 0x01 | wrapped_key_len(uint16 big-endian) | RSA-wrapped AES key | IV(12) | ciphertext || tag(16)`。
延用 RSA-OAEP SHA-256 與每次新產生 AES-256 金鑰；AAD 為
`JSON.stringify(["credential-vault/collection", 1, collectionId])` 的 UTF-8 bytes。
先限制 envelope 大小、wrapped key 長度及版本，再解密；憑證與集合的 envelope 不可互換。

下載使用 `application/octet-stream` 與 `download` 行為，不在 iframe、object 或新頁面載入內容。
下載檔名去除路徑、控制字元、雙向文字控制及平台保留字元；必要時使用安全 fallback 名稱，
原始檔名仍保留在加密 metadata。副檔名／MIME／`accept` 只作提示，不聲稱內容安全。
不呼叫遠端解析、掃毒或 telemetry 傳送附件、金鑰及檔名。

每個解鎖 session 有 generation token。選檔、加密、fetch、解密與建立 Blob 後都確認 token 仍有效。
上鎖／取消時 abort fetch、移除明文參照、清除檔案 input、撤銷 Blob URL，並使未完成工作失效。
Web Crypto 已啟動的工作不保證可中止；其結果必須丟棄。GC 與瀏覽器下載副本不具抹除保證。

### 4. 儲存、配額與 batch 協定

| 項目 | 初版預設／硬性規則 |
|------|-------------------|
| 單檔原始內容 | 10 MiB；對應密文上限加 33 bytes |
| 每筆 active 附件 | 5 個，跨所有 file 欄位合計 |
| 每使用者附件配額 | 250 MiB，包含 active、retired、已接收 staged 及尚未接收的保留額度 |
| Retired／未提交 batch TTL | 24 小時；只能清理非 active 資料 |
| Section 實例／欄位 | 每筆最多 100 個 section 實例、200 個欄位；每個重複定義最多 20 個實例 |
| 清單值／關聯 | 每欄最多 100 個值；每筆最多 50 個有效及失效關聯合計 |
| Metadata 密文 | 憑證維持 1,000,000 字元上限，新增集合亦有相同上限 |
| Batch metadata／備份 manifest | 各最多 32 MiB；header 最多 4 KiB |
| 備份容器 | 最多 320 MiB、10,002 個 entries；只接受 STORE |

MiB 為 1,048,576 bytes。可設定的限制須透過 capabilities 回傳；變更須重跑邊界與負載驗證。
HTTP body 限制在 proxy 及應用串流讀取時實施，不能只信任 Content-Length 或先把全檔讀完才檢查。
對 pending quota 的保留與釋放必須是原子操作，並限制並行接收的檔案數與 batch 數，避免記憶體及配額競態。

新增實體為 `vault_state`、`vault_collections`、`vault_batches`、`credential_attachments`。
附件 staged 時綁 owner／batch／預定 credential ID，尚未建立的 credential 不需要先有 row；
提交時設定可驗證的 credential FK。附件 ID 不能重用或綁到別筆紀錄。
額度超限時不可先刪舊附件騰出空間，須回報可用容量及所需保留空間。

以下路徑均在 `/api/v1` 下；JSON／binary 都必須以 owner 過濾，另一位使用者的 ID 回 404。

| 介面 | 行為 |
|------|------|
| `GET /vault/capabilities` | 回協定／內容版本、支援的型別、大小及數量限制 |
| `GET /vault/snapshot` | Cursor 分頁的所有 credential／collection metadata；每頁攜相同 `vault_revision`，不帶附件 bytes |
| `POST /vault/batches` | 準備 metadata operations、所有 expected revisions、active 附件集合及上傳計畫，保留額度 |
| `PUT /vault/batches/{batch_id}/attachments/{attachment_id}` | 接收宣告長度的 raw binary envelope，檢查實際大小及預期密文 SHA-256；相同內容重試可接受 |
| `POST /vault/batches/{batch_id}/commit` | 重檢版本、revision、owner、附件完整性及配額，在同一 transaction 內提交 |
| `GET /vault/batches/{batch_id}` | 查詢 pending／committed／aborted／expired 狀態與提交 receipt，處理不明結果 |
| `DELETE /vault/batches/{batch_id}` | 取消未提交 batch，釋放其 reservation 與 staged bytes；已提交者不能藉此撤銷 |
| `GET /credentials/{credential_id}/attachments/{attachment_id}` | 取得該 owner／credential 的 active 或尚在保留期的 retired 密文；禁止取得 pending bytes |

所有 batch mutation 與上傳要求 `VaultProvenUser`。Metadata／附件讀取要求有效帳號；UI 仍須解鎖才使用。
現有 credential create／update／import／revoke／delete 需接入相同版本、revision 及 proof 規則，
不得留下可繞過新格式保護、附件同步或整體 revision 的舊寫入路徑。
Template 所有寫入／sync／import 增加格式能力檢查，保留 owner 隔離與 `sync_version`，未知定義不能被忽略後存回。

準備請求包含 `expected_vault_revision`、metadata `operations[]` 與 `attachment_uploads[]`。
每個 operation 指明實體種類、ID、操作、expected row revision、宣告的內容版本及必要密文；
create 的 expected row revision 為 0。Credential operation 另帶完整 `active_attachment_ids`。
上傳計畫只包含附件 ID、預定 credential ID、密文長度與密文 SHA-256，不含原始檔名、MIME 或金鑰。
準備本身不使新紀錄可見，也不鎖住現有紀錄。

提交在單一 transaction 中 compare-and-swap `vault_revision`，檢查所有 row revisions、
active 附件的歸屬及 bytes，再套用 operations、推進各 row revision 與整體 revision，標記 batch committed。
集合 tombstone、憑證 revoke／delete 亦推進整體 revision。
後端不能比對密文內附件參照與外部宣告；客戶端須由同一份已驗證內容產生兩者。
重複 commit 回原 receipt，不新增附件、不再次推進 revision。競態、取消與 cleanup 同樣受 transaction 保護。

回應 receipt 有 batch ID、提交後整體 revision、受影響 row 的 revision 及密文雜湊。
客戶端重讀驗證；相同 revision 的密文不符時顯示錯誤並保留修復資訊，不無條件回寫舊資料。
若重讀已是較新 revision，則顯示資料已再被修改並重新載入，不誤判為儲存損毀或覆寫較新資料。
API／附件回應加 `Cache-Control: no-store`；Service Worker 維持 `/api/` network-only。

| 狀態碼 | 條件 |
|--------|------|
| 403 | 缺少或失效 vault proof |
| 404 | 不存在或不屬於目前 owner 的物件 |
| 409 | Revision 衝突、容量保留不足、batch 狀態衝突；以不同 error code 區分 |
| 413 | 實際 body／檔案超限 |
| 422 | 不合法宣告、ID、數量、長度、雜湊或附件歸屬 |
| 426 | 缺少或不支援的寫入協定／格式能力；提示更新客戶端 |

### 5. 完整備份與還原

V2 容器只允許 `header.json`、`manifest.enc` 與 `attachments/{attachmentId}.bin`。
使用有維護的 ZIP reader/writer，唯讀存取預期 entries，不解壓到檔案系統。
拒絕 duplicate entries、額外檔案、非預期路徑、symlink、壓縮方法及超限宣告／實際 bytes。
檔案路徑只使用 UUID，原始檔名與所有使用者內容都在加密 manifest。

Header 為 `{ type: "credential-backup", version: 2, backupId, kdfVersion: 2, salt, manifestIv }`。
Salt 為 32 random bytes、IV 為 12 random bytes，base64 編碼；只接受已知的 KDF version，
不採用容器任意指定的記憶體／迭代參數。以既有 Argon2id KDF v2 導出 AES-256-GCM 金鑰，
manifest 的 AAD 為 `JSON.stringify(["credential-vault/backup", 2, backupId, 2, salt])` 的 UTF-8 bytes。
每份備份重新產生 ID、salt 與 IV；tag 為 128 bits。

Manifest 包含匯出時間、來源 credential／collection IDs、完整解密內容、狀態、到期、來源建立及更新時間，
以及每個被引用附件的來源 AAD IDs、金鑰、預期路徑、大小與密文雜湊。
來源帳號私鑰不放入備份，也不作為還原的必要條件。
附件可保留原本的已驗證 envelope，解密金鑰由備份密碼保護的 manifest 提供。

匯出步驟：取完整含 revoked 的 metadata 快照並驗證結構，逐檔驗證雜湊／GCM，
丟棄每檔驗證用明文後將密文寫入容器。匯出結束前再次確認整體 revision 未變；
若有更動或來源已失效，取消並重試，不宣告完整成功。Staged／未引用 retired 檔案不匯出。
缺失集合參照依前述根集合／未分類規則正規化匯出副本，不修改來源資料。

還原分成 preflight 與提交：先驗證 header、密碼、manifest、所有 entries 及每個附件的 GCM，
逐檔丟棄明文，確認限制及配額後才建立 staged batch。
再重新讀取附件，配置新的 credential、collection、section、field、relation target 與 attachment IDs，
重新產生附件金鑰與 IV，依新 AAD 加密，並重建全部有效關聯。
無法對應的來源關聯移入 `unresolvedRelatedIds` 顯示失效，不連到目標 vault 的既有同名紀錄。
有效 status／expires 保留；server 建立時間為還原當下，來源時間保留於加密備份 provenance。
全部 staged 完成才提交；失敗僅清理該 batch，既有資料及可見紀錄不變。

備份不依賴來源清單的 decrypted cache、單頁或固定 10,000 筆截斷。
不能在 UI 顯示匯出成功後才發現缺檔；超限時明確回報，不截斷、不降級到 metadata-only 備份。
完整備份不包含 template 定義；template 保留獨立的 template 匯出／匯入介面及 type 識別。

### 6. 遷移、相容性與發布

- Alembic 新增 revision／宣告版本、vault state、集合／batch／附件實體，舊 row 初始化 revision 1、內容版本 1。
- 讀取 v1 credential 時，將 map 轉為「一般」section，保留 metadata、值、順序、空白與換行。
  舊 map 沒有可靠的秘密設定，轉換後所有既有值預設遮蔽；使用者可自行調整。
  ID 在本次編輯工作階段保持穩定，只有明確保存才提交 v2；讀取不產生大量重寫。
- 舊 template 轉成一個非重複 section，保留 label／required／validation 與可用的遮蔽設定。
  舊非秘密 `defaultValue` 的移除先顯示差異，由使用者明確轉換後才保存；不默默丟棄原定義。
- V1 credential backup 仍能讀，轉換後由新 batch 還原；template `.cvault` 不得誤當 credential backup。
- 未知未來版本以不可編輯狀態顯示更新提示，原始密文保持不動；不猜測成 legacy。
- 升版前做可驗證的 DB snapshot，後端與前端成套發布。所有舊寫入路徑先完成 capability gate。
  `VERSION` 是產品版本，與本規格的內容版本分開；本次文件工作不修改它。
- V2 寫入後不得直接切回只能理解 v1 的服務。若需還原 pre-upgrade snapshot，須說明會失去其後寫入，
  依專案破壞性操作規則另行確認；不以刪表或清 DB 作為預設 downgrade。

## Acceptance Criteria

| ID | 可觀察驗收結果 | 對應需求 |
|----|----------------|----------|
| AC-01 | Template 與 blank credential 均可建立／重排 section、五種欄位及重複實例；相同 label 不互相覆寫 | FR-01、02 |
| AC-02 | 保存再解鎖後型別、ID、遮蔽、清單、文字空白及換行完全保留 | FR-01、12 |
| AC-03 | 六種情境用合成資料各完成一個可保存、重開、複製常用值的案例；無法匯出的私鑰不強制上傳 | FR-05、14 |
| AC-04 | 空檔與二進位檔下載 bytes 相同；檔名惡意輸入不變成路徑或執行內容 | FR-05、06 |
| AC-05 | 變更任一 envelope／tag／manifest 雜湊或 AAD ID 均失敗，且不建立下載 Blob | FR-06 |
| AC-06 | 瀏覽、搜尋與集合切換均不請求附件內容；以 1,000 筆 fixture 驗證無預載 | FR-06 |
| AC-07 | 另一位使用者及其 admin 無法讀寫附件／collection／batch；只持 token 無法上傳、提交或破壞資料 | FR-08 |
| AC-08 | 在上傳／解密／備份期間上鎖，明文 UI、Blob URL 與 input 被清除，遲到結果不下載或重新顯示 | FR-10 |
| AC-09 | 中斷／取消、quota 競態與 concurrent commits 不改掉原資料；重複 commit 只有一次結果 | FR-07、09 |
| AC-10 | 舊客戶端透過所有舊 create／update／import／sync 路徑無法覆寫 v2；衝突後不自動回滾別人的更新 | FR-07、08、12 |
| AC-11 | 三層上限與循環會被阻擋；非法或失效圖仍能找到紀錄，集合刪除不減少憑證／附件數量 | FR-03、13 |
| AC-12 | 改名／重排不需重新加密附件；跨紀錄複製／還原會改 ID、金鑰及 AAD；失效關聯有明確提示 | FR-03、04、06 |
| AC-13 | 量測含 active、retired、staged 及 reservations 的實際配額；不信任缺失／偽造 Content-Length | FR-09 |
| AC-14 | 清理不刪 active 或正提交附件；retired 在 TTL 內可讀、期滿可清理，空間釋放有可重跑結果 | FR-07、09 |
| AC-15 | 含 revoked、深層集合、重複 section、關聯及附件的全量備份，可在另一帳號還原且不需要來源私鑰 | FR-11 |
| AC-16 | 錯誤密碼、缺檔、截斷、重複 entry、壓縮／路徑攻擊、未知 KDF 及部分超限均無可見部分匯入或假成功 | FR-09、11 |
| AC-17 | V1 credential／template／backup fixtures 可讀及明確轉換；升級前後舊資料筆數及內容不變 | FR-12 |
| AC-18 | DB snapshot 在附件 staged／committed 狀態下還原仍一致；正式 nginx 的 body limit、no-store 與 SW 行為實測正確 | FR-07、09、11、14 |

## Dependencies

- 現有 Web Crypto、hash-wasm Argon2id、vault proof、React Query 的明文生命週期及 owner-scoped API。
- SQLite transaction／online backup、Alembic、目前 Docker Compose／nginx 配置。
- 一個有維護且支援 STORE、逐 entry 處理及嚴格限制的 ZIP reader/writer；選型、鎖版與 bundle 成本在 PLAN Phase 1 驗證。
- 獨立安全審閱及實際瀏覽器／NAS 驗證；作者執行測試不能替代獨立審閱。

## Open Questions

- 待使用代表性 NAS 與瀏覽器量測確認預設配額／TTL 是否適當；目前採上表數值規劃。
- ZIP dependency 選型在 Phase 1 完成，不改變 STORE-only、完整性或記憶體限制；驗證未完成不可進入格式實作。
- 是否需要更深集合或紀錄內遞迴結構，留待實際案例證明後以新 ADR 處理，不阻擋本次既定範圍。

## References

- [ADR-003](../decisions/003-structured-credentials-and-attachments.md)。
- [PLAN-004](../plans/PLAN-004-structured-credentials-and-attachments.md)。
- [官方來源與研究紀錄](../research/2026-11-05-structured-vault-use-cases.md)。
- [SPEC-001](SPEC-001-template-system.md)、[SPEC-002](SPEC-002-backend-template-api.md)、[SPEC-003](SPEC-003-e2ee-architecture.md)。
- [Testing](../testing.md)、[Agent Guide](../AGENT-GUIDE.md)。

---

*Created: 2026-11-05*
*Last updated: 2026-11-05*
