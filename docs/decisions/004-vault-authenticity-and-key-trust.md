# ADR-004: Vault 金鑰信任、用途隔離與內容簽章

> Architecture Decision Record

## Status

Proposed（2026-11-05）。為 ADR-003／SPEC-004 格式定案的必要前置決策，尚未實作完整簽章協定。
既有服務的小範圍金鑰處理修補與未來格式實作分開驗證、發版；不以文件完成代表已部署。

## Context

可信前端必須在資料 API 不可信時，仍能確認解鎖後使用的金鑰、不同密碼操作的用途，
以及下載的紀錄是否由持有 vault 私密材料的使用者授權建立。
RSA 公鑰加密與 AES-GCM 的組合提供解密完整性，不能單獨證明內容作者；公鑰本來就能公開取得。
引入私鑰附件後，內容來源及外部狀態的完整性應成為格式的必要條件。

本決策修訂 [ADR-001](001-e2ee-architecture.md) 的安全邊界，並優先於
[ADR-003](003-structured-credentials-and-attachments.md) 原始草案的加密 envelope 與信任描述。
未部署修補的利用方式、重現腳本及完整攻擊流程不收錄到公開研究文件。

## Decision

### 1. 解鎖的信任根來自 KEK 保護的私密材料

- 以 vault 密碼及既有 Argon2id KDF v2 解開私密材料，再由 RSA 私鑰導出公鑰。
  與 API 宣告公鑰不符即拒絕解鎖；之後只使用導出的公鑰。
- 金鑰比對、失敗、密碼變更及備份還原都不得默默採用 API 新提供的公鑰。
- Session 私鑰保持 non-extractable。導出公鑰所需的短暫可匯出表示不持久化、不記錄，
  釋放私密參照及可清除的 byte buffer；不宣稱可安全抹除 JavaScript 字串。
- 既有私鑰可在瀏覽器明確升級為 key bundle，不清空 vault、不要求重新加密全部既有資料。

### 2. 每種 RSA-OAEP 用途使用固定 label

| 用途 | OAEP SHA-256 label（UTF-8） |
|------|----------------------------|
| 既有 proof v1 | `credential-vault/vault-proof/v1` |
| 新 credential envelope v3 的 DEK | `credential-vault/credential-key/v3` |
| 新 collection envelope v2 的 DEK | `credential-vault/collection-key/v2` |

Legacy credential blob v1／v2 的 empty label 僅限受控讀取相容路徑，不用於 proof、
collection 或新格式寫入。任何新 RSA 用途需先分配不同的 label，禁止解密失敗後改試 empty label。
前後端有跨語言測試向量，證明用途不匹配會失敗。現有資料不因 proof label 升級而重加密。

### 3. 以 KEK 保護的 ECDSA P-256 金鑰簽署新資料

客戶端產生獨立於 RSA 的 ECDSA P-256／SHA-256 簽章金鑰，放入 AES-256-GCM 加密的 key bundle。
Bundle 含 vault UUID、bundle version、RSA 私鑰、簽章私鑰、導出的驗證公鑰與 signer key ID。
驗證公鑰與私鑰須在本機再次確認匹配；驗證信任根不取自伺服器的未保護公鑰欄位。
Bundle 使用明確 domain／version／vault UUID 的 AAD，KDF 參數只接受既有 allowlist。

新 credential、collection 及刪除／revoked 狀態都攜簽章。簽章訊息以固定順序的 JSON array 編碼，
包含 domain、簽章版本、vault／owner／實體種類／ID、內容與 envelope 版本、signer ID、
密文 SHA-256、該 row 的下一 revision、`is_active`、`expires_at`、`revoked_at`、`is_deleted`。
不適用狀態使用明確 null；時間正規化為 UTC，布林／數字不可使用字串代替。
Web Crypto 的固定 64-byte P1363 簽章表示、正規化規則及錯誤向量須在 Phase 1 審閱後才定案。

驗證順序：可信 bundle 公鑰 → 簽章與外部狀態 → 已簽的密文雜湊 → 解密 → schema／附件參照驗證。
驗證失敗不下載附件、不依未驗證狀態隱藏紀錄、不自動修復簽章或降級成舊資料。
公開金鑰產生的新密文、修改外部旗標、跨實體／跨 owner 置換均須被拒絕。

### 4. Proof v2 使用有 domain 的 nonce 簽章

新格式上線前，把 proof 升級為簽署專用 domain 的 server nonce；不再回傳任何 RSA 解密結果。
固定簽章訊息綁定 proof 版本、nonce／slot ID、vault／owner、穩定的 auth session ID 與有效期限。
Proof domain 與內容簽章 domain 不同，驗證端不得將兩種簽章交叉接受。
伺服器使用已登記的簽章公鑰驗證身分，但客戶端資料來源驗證仍只信任解開 bundle 的公鑰。

每個 auth session 有最多 8 個 live proof slots，pending challenge 最多 8 個，pending TTL 60 秒。
發出新 challenge 不使 live slots 失效，不因容量不足逐出 live proof。驗證後的 proof 最長 300 秒，
客戶端拒絕低於 60 秒或超過 300 秒的協定期限，並合併同頁並行更新。
Slot 綁定同一 refresh session chain；長時間還原在後續請求前更新 proof，不能清除 staged batch。
Challenge 的限流、nonce 單次使用、登出撤銷與過期清理須先完成。

### 5. 附件按 4 KiB 分桶 padding

新附件 envelope v2 加密 `uint64_be(original_length) | original_bytes | random_padding`。
內文補至 4,096 bytes 的整數倍；最少一個 bucket。原始大小與檔名只在加密 manifest 內。
AAD 綁定 domain、附件版本、credential ID、field ID 與 attachment ID；DEK 每次新增／替換重建。
可見 envelope 大小為 padded plaintext 加 33 bytes；後端配額／稽核採可見密文大小。

此決策降低小型金鑰的精確長度辨識，仍會洩漏 bucket、附件數量、歸屬與時間模式。
集合 parent／membership 保持加密，是為避免直接公開關係圖，並不代表隱藏所有流量 metadata。
不加入假附件、隱藏存取流量或承諾全 vault 大小保密。

### 6. Legacy 與備份的來源標示

- 未簽章舊資料標記 `legacy-unverified`；能解密不能提升為「來源已驗證」。
  只有使用者明確核對／編輯後才能建立新簽章，不能背景批次替所有舊資料背書。
- 遷移前只讀檢查正式資料的 envelope 版本；未確認沒有 v1 前不移除 v1 reader。
  即使有資料，也不得以 unknown magic 自動走 v1；讀取相容模式需明確啟用。
  相容路徑只接受舊文字 map，不接受未簽章的附件／新 sections，避免把新資料降級成 legacy。
- V2 備份的加密 manifest 保存來源簽章、公鑰、完整 signed state 及 legacy provenance。
  還原先驗證來源資料，再以目標 bundle 的公鑰／簽章金鑰重綁與加密。
  Legacy 備份的來源未驗證狀態必須保留，不能以重新簽章冒充原作者證明。
- 新備份密碼至少 12 字元；提供以 CSPRNG 產生的 128-bit 以上復原秘密，建議另存。
  舊備份的讀取不套用新的最小長度，避免失去還原能力。

### 7. 信任邊界與發布 gate

在可信前端、未外洩 vault 密碼／私鑰的條件下，控制資料 API 的攻擊者不能解開秘密，
也不能建立可通過新簽章驗證的紀錄或外部狀態。這是附件格式必須驗證的威脅模型。
E2EE 不防禦被替換的前端、解鎖中的 XSS、惡意擴充套件、拒絕服務、刪漏資料或整份合法舊快照回放。
本機可記錄見過的最大 revision 協助偵測回退，但新裝置不能憑單一伺服器證明最新狀態。

**Phase 1 格式定案與 Task 2.5 均保持關閉**，直到 proof 用途隔離、公私鑰綁定的 regression tests
及成套部署證據完成，且此 ADR 的簽章／padding／來源遷移設計獲獨立重審。
原草稿的外部審閱是設計輸入，不是對修正版或新程式碼的核准。

## Consequences

### Positive

- 明確區分資料保密、金鑰匹配、內容來源與外部狀態完整性。
- 不需為小範圍既有服務修補重新加密整個 vault；未來附件有可驗證的內容來源。
- Proof 與內容操作有獨立 domain，未來 proof 不執行資料解密。

### Negative

- Key bundle、簽章、proof slots、相容模式與狀態修改增加 migration／UI／測試成本。
- 每個附件至少占一個 4 KiB bucket；配額及邊界測試須計入 padding。
- 舊資料來源無法事後憑加密補證，需保留可信程度與使用者核對流程。

### Neutral

- 保留 RSA-OAEP／AES-GCM／Argon2id 及 ADR-003 的集合／section／關聯功能範圍。
- ZIP 依賴必須在現有 CSP 下運作，禁止為方便依賴而加入 `blob:` worker、CDN 或 JavaScript eval。
  初選有維護的 STORE-only library 並停用動態 workers；選型須實測，不能憑記憶判定不相容。
- 小型自寫 ZIP parser 不自動更安全；只有在獨立審閱、格式邊界及 fuzz 測試證明必要時才另提決策。

## Alternatives Considered

| 方案 | 結果 |
|------|------|
| 只驗 GCM／AAD／SHA-256 | 不提供作者證明，不符合本次附件來源需求 |
| 信任 API 提供的驗證公鑰 | 信任根仍由不可信來源決定，不採用 |
| 只加 warning、不加簽章 | 可用於 legacy 提示，不能作為新附件格式的來源保證 |
| 所有 legacy 資料解密後自動簽署 | 無法證明舊資料來源，不採用 |
| 不做 padding | 會公開精確檔案長度；本次選擇固定 bucket 並明示剩餘洩漏 |

## References

- [SPEC-004](../specs/SPEC-004-structured-credentials-and-attachments.md)、[PLAN-004](../plans/PLAN-004-structured-credentials-and-attachments.md)。
- [W3C Web Crypto](https://www.w3.org/TR/2017/REC-WebCryptoAPI-20170126/)（查閱：2026-11-05）。

---

*Created: 2026-11-05*
*Last updated: 2026-11-05*
