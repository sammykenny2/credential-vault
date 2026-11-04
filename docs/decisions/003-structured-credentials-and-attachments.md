# ADR-003: 結構化憑證、集合與端到端加密附件

> Architecture Decision Record

## Status

Proposed（2026-11-05）。本文件記錄待審閱的設計，尚未實作；建立文件不代表核准部署或資料遷移。

## Context

目前 `CredentialData.fields` 是 `Record<string, string>`，template 與臨時新增欄位皆為平面文字欄位。
實際憑證沒有保存欄位 ID、型別或 `isSecret`，顯示時重新依名稱猜測遮蔽方式。
開發者常需要保存 JSON 金鑰、還原檔、keystore、憑證及 profile，並將相關密碼與識別資訊一起管理。

Apple team、GCP project、Cloudflare account 等背景資訊，會對應多份可獨立到期或輪替的憑證。
同一張簽署憑證也可能被多份 profile 共用；把這些資料全部塞進一筆紀錄，或依 app 複製秘密，
都會增加更新遺漏、混用環境與備份不完整的風險。常見案例與官方來源見
[研究紀錄](../research/2026-11-05-structured-vault-use-cases.md)。

既有架構以瀏覽器 Argon2id、RSA-OAEP 與 AES-256-GCM 保護秘密。
清單頁會載入並解密憑證內容；後端 `encrypted_data` 上限為 1,000,000 字元。
因此附件需要與清單使用的密文分開，延續 [ADR-001](001-e2ee-architecture.md) 的加密邊界。

## Decision

### 1. 將整理層次分成集合、section 與紀錄關聯

- 集合支援最多三層，根集合算第一層。每筆憑證可有一個主要集合，亦可不分類。
- 每筆憑證有一層具名稱、順序與穩定 ID 的 section；section 只包含欄位。
- Template 可定義可重複的 section，實例各自產生 ID，用於 keystore aliases 或權限規則。
- 欄位型別為 `text`、`secret`、`multiline`、`list`、`file`，並明確保存 `isSecret`。
- 以加密的紀錄 ID 關聯共用材料；生命週期獨立的 API key、憑證與 profile 各自成筆。
- 初版不開放 section 內再巢狀 section。集合與 section 均不代表 ACL 或分享權限。

### 2. 使用有版本的加密內容與獨立版本識別

- 憑證內容升為 `schemaVersion: 2`；集合內容從 `schemaVersion: 1` 開始。
- Template 定義、localStorage 格式與 template 匯出格式各自升至 v2。
- `sync_version`、資料列 `revision` 與內容格式版本分開，不混用。
- 既有憑證的 crypto blob v2 與 vault KDF v2 保留。集合使用獨立 domain 的加密 envelope。
- 後端只記錄宣告的內容版本；瀏覽器負責解密後的嚴格 runtime validation。
- 新版寫入協定要求版本能力與 revision；拒絕舊客戶端覆寫新格式。版本能力不是權限憑證。

### 3. 每個附件版本使用獨立 AES 金鑰

- 瀏覽器為每次新增或替換產生新的附件 UUID、AES-256 金鑰與 96-bit IV，使用 128-bit GCM tag。
- 附件金鑰、原始檔名、MIME、原始大小及密文 SHA-256 放在憑證加密內容的附件 manifest。
- 附件 AAD 綁定協定 domain、附件格式版本、憑證 ID、欄位實例 ID 與附件 ID。
  顯示名稱、section 名稱、排序及集合路徑不作為 AAD。
- 後端只保存附件 envelope 的二進位密文、opaque ID、歸屬、狀態、大小、時間與密文雜湊。
  不保存明文內容、原始檔名、MIME 或明文雜湊，也不做跨使用者去重。
- 附件內容初版只支援原樣保存與使用者主動下載；不預覽、解壓縮、執行、安裝或解析廠商格式。

### 4. 初版附件存於 SQLite BLOB

在目前個人／小型團隊、NAS 與有限大小附件的使用情境，採獨立附件表的 SQLite BLOB。
附件不加入憑證清單查詢、不放入 webroot，也不新增 listener、物件儲存服務或對外 URL。
既有 `app.maintenance` 的 SQLite online backup 可涵蓋同一資料庫內的附件與 metadata；
發布前仍須驗證 snapshot、還原、資料庫成長與 NAS 實際負載。

預設每檔 10 MiB、每筆最多 5 個附件、每使用者 250 MiB 附件密文與保留空間。
這些是待效能驗證的可設定初始值，前後端共用能力資訊；保留舊附件也占配額。

### 5. 以 staged batch 與 revision 保護寫入

先保存待提交的密文 metadata 與上傳計畫，再接收附件密文，最後在單一 SQLite transaction 內
檢查 revision、附件完整性與配額，提交所有 metadata 及附件狀態。
新紀錄不必先建立可見的空殼；匯入也使用相同機制。

- 憑證與集合各有 revision，使用者另有整體 `vault_revision`。
  所有提交及直接狀態變更均以整體 revision 作 compare-and-swap，避免集合圖與備份競態。
- 上傳、提交及 vault 資料的破壞性操作要求 `VaultProvenUser`；所有讀寫都以 owner 過濾。
- 提交可重試且具冪等性。衝突回傳 409，不能靜默重試覆寫其他修改。
- 新附件在提交前不取代舊附件；被替換附件在提交後保留 24 小時，未提交 batch 亦於 24 小時過期。
  清理由明確狀態與時間判斷，不解析密文猜測引用，也不刪除目前 active 附件。
- 提交後重讀失敗或網路結果不明時先查 batch 狀態，不沿用現有的無條件回滾覆寫做法。

### 6. 集合結構與關聯保留在密文內

集合名稱與 `parentId` 放在集合密文；主要 `collectionId` 與 `relatedCredentialIds` 放在憑證密文。
後端不建立可讀的集合樹或紀錄關聯表。完整解鎖快照由客戶端驗證深度、循環與同 owner 的目標。
整體 revision 防止兩個誠實客戶端依不同快照提交互相衝突的結構變更；後端無法驗證密文內的圖。

刪除集合寫入 tombstone，不級聯刪除任何憑證、附件或子集合。
子集合的失效 parent 以根層顯示，憑證的失效集合以「未分類」顯示，下次保存時正規化。
尚未載入的目標不能提早判定為遺失。關聯目標刪除時顯示「目標已不存在」，不刪除來源紀錄。

### 7. 備份是包含附件的獨立可還原封裝

`.cvault` v2 使用 ZIP STORE 容器：固定名稱的加密 manifest 與 UUID 路徑的附件密文。
備份密碼以既有 Argon2id KDF v2 導出金鑰，加密 manifest；manifest 包含完整憑證內容、
附件解密金鑰、來源 AAD 身分、集合、關聯、狀態與各附件密文的大小及雜湊。
附件保持其已驗證的 AES-GCM 密文，故備份不依賴來源帳號私鑰，也不需一次解密全部檔案。

完整匯出讀取一致的全量快照，包含 revoked 紀錄，不能只備份清單目前載入的頁面。
還原先驗證全部容器內容，再重新配置 ID、重建關聯、重新加密附件，最後以單一 batch 提交。
缺檔、未知版本、驗證失敗或配額不足都不能報告完整成功。舊版 v1 備份仍可讀。

### 8. 保留資料遷移與安全限制

Alembic 採新增式 migration；既有密文不在後端轉換、不清空資料庫。
瀏覽器將舊內容轉成一個 section，保留原始字串與 metadata；首次明確保存才寫回 v2。
舊資料未保存的遮蔽設定無法還原，採保守遮蔽並允許調整。發布前備份與舊版寫入封鎖是必要條件。

此設計不防禦解鎖中的 XSS、惡意擴充套件或遭替換的前端程式。
AEAD／AAD 不代表作者簽章，也不防禦惡意伺服器回放整份舊快照。
下載產生的明文副本、SQLite 舊頁面及歷史備份不具安全抹除保證；vault 的 revoked 狀態不會撤銷外部服務金鑰。

## Consequences

### Positive

- Template 與 custom 欄位可組合文字、秘密、清單與檔案，涵蓋常見簽署及雲端憑證。
- 一層可重複 section 與紀錄關聯可避免大量重複秘密，並保留獨立的到期與輪替紀錄。
- 附件按需載入，避免瀏覽清單時將全部檔案載入記憶體。
- 備份不依賴原帳號金鑰，跨帳號還原能保留資料關係且驗證完整性。

### Negative

- Batch、配額、revision、格式相容性與 ZIP reader/writer 增加實作及測試成本。
- 整體 revision 會使同一使用者的並行修改產生較保守的衝突，需要清楚的重試介面。
- SQLite 檔案與 snapshot 會變大；保留舊附件需要額外配額及定期清理。
- E2EE 限制後端掃毒與內容驗證；任意私密樹狀結構只能在客戶端驗證。

### Neutral

- 認證方式、vault 密碼 KDF 與 RSA 金鑰階層沿用現況。
- 一般 template 定義仍為伺服器可讀 metadata；本次 v2 template 移除所有值的預設設定，避免放入秘密。
- 分享、ACL 繼承、無限巢狀、版本歷史、外部金鑰自動輪替與秘密注入均不在本次範圍。

## Alternatives Considered

| 方案 | 優點 | 缺點與未採用原因 |
|------|------|------------------|
| 檔案 Base64 塞入既有欄位 | 變更少 | 清單全載入、雙重編碼膨脹、欄位／備份語意不明確 |
| 只加附件、不加群組 | 範圍較小 | 相依的檔案與密碼難辨識，多個環境及 key 的欄位會混在一起 |
| 任意遞迴 JSON 表單 | 結構最自由 | 編輯、驗證、遷移與 accessibility 成本高，常見案例尚無必要 |
| 整個 project 存成一筆 | 背景資訊集中 | 不同憑證共用寫入／到期單位，共用材料容易重複 |
| 明文集合樹及關聯表 | 後端容易驗證與查詢 | 洩漏專案名稱、資源關係及使用背景 |
| 檔案系統／物件儲存 | 適合較大附件 | 增加雙儲存一致性、備份與部署需求；超出初版負載需求 |
| 伺服器解密、掃毒或解析 | 方便內容處理 | 違反 zero-knowledge invariant，並擴大秘密接觸面 |

## References

- [SPEC-004](../specs/SPEC-004-structured-credentials-and-attachments.md)：需求、協定與驗收。
- [PLAN-004](../plans/PLAN-004-structured-credentials-and-attachments.md)：實作順序、測試與發布。
- [2026-11-05 研究紀錄](../research/2026-11-05-structured-vault-use-cases.md)：一手來源及設計推論。
- [ADR-001](001-e2ee-architecture.md)、[ADR-002](002-argon2id-sign-in-passwords.md)。

---

*Created: 2026-11-05*
*Last updated: 2026-11-05*
