# ADR-004: Vault 金鑰信任、用途隔離與內容簽章

> Architecture Decision Record

## Status

Accepted（2026-11-05）；§1 至 §4、§6 已在分支實作，尚未發版。§5 的附件 padding 與 §2 的新 envelope label 隨 ADR-003 附件格式實作。
不以文件或本機測試完成代表已部署。

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
- 這種拒絕是安全事件，介面必須與「密碼錯誤」分開顯示（`VaultKeyMismatchError`）。
- 金鑰比對、失敗、密碼變更及備份還原都不得默默採用 API 新提供的公鑰。
- Session 私鑰保持 non-extractable。導出公鑰所需的短暫可匯出表示不持久化、不記錄，
  釋放私密參照及可清除的 byte buffer；不宣稱可安全抹除 JavaScript 字串。

### 2. 每種 RSA-OAEP 用途使用固定 label

| 用途 | OAEP SHA-256 label（UTF-8） |
|------|----------------------------|
| Proof v1（僅一次性升級使用） | `credential-vault/vault-proof/v1` |
| 新 credential envelope v3 的 DEK | `credential-vault/credential-key/v3` |
| 新 collection envelope v2 的 DEK | `credential-vault/collection-key/v2` |

Legacy credential blob v1／v2 的 empty label 僅限讀取，且只有在紀錄簽章驗證通過後才會執行 RSA 解密。
任何新 RSA 用途需先分配不同的 label，禁止解密失敗後改試 empty label。
Proof v2 不使用 RSA：簽署 nonce 不會回傳任何解密結果。

### 3. 以 KEK 保護的 ECDSA P-256 金鑰簽署紀錄

客戶端產生獨立於 RSA 的 ECDSA P-256／SHA-256 簽章金鑰，放入 AES-256-GCM 加密的 key bundle，
存於 `users.encrypted_private_key`：

```text
ASCII("CVKB") | version(1) | IV(12) | AES-GCM(KEK, plaintext)
plaintext = vault_id(16) | u16 len | RSA PKCS8 | u16 len | ECDSA PKCS8 | u16 len | ECDSA SPKI
AAD = JSON.stringify(["credential-vault/key-bundle", 1])
```

驗證公鑰取自 bundle，解開時以自我簽章測試確認與私鑰相符；伺服器的 `users.signing_public_key` 只用於檢查 proof，
客戶端驗證紀錄時不讀它。Vault ID 由客戶端隨機產生，在 bundle 內受 GCM 保護，因此不需放進 AAD。
Signer ID 是驗證公鑰 SPKI 的 SHA-256。

簽章訊息是下列陣列的 `JSON.stringify` UTF-8 bytes（signature version 1）：

```json
["credential-vault/record-signature", 1, vaultId, signerId, "credential", id, revision,
 ciphertextSha256Hex, isActive, expiresAtEpochMs, revokedAtEpochMs, origin]
```

- `ciphertextSha256Hex` 是 `encrypted_data` 解碼後 bytes 的雜湊。Envelope 與內容版本都在這些 bytes 內，不另列。
- 時間正規化為 UTC epoch 毫秒，沒有時區的值視為 UTC（SQLite 的回傳方式）；不適用時為 `null`。布林與數字不可用字串代替。
- 簽章是 64-byte P1363，以標準 base64 存放；格式由 `frontend/src/__tests__/fixtures/vault_signature_vectors.json` 固定。
- 伺服器不解讀紀錄簽章。Proof 已阻擋只有 token 的寫入；瀏覽器才是驗證者。

驗證順序：可信 bundle 公鑰 → 簽章與外部狀態 → 解密。**未簽章的紀錄一律拒絕，連 RSA 解密都不執行。**
驗證失敗的紀錄不得被靜默略過，介面要列出來並只提供刪除。

從已存紀錄衍生新狀態（撤銷、確認來源）時，**只能簽署使用者實際看過的那筆紀錄，且要先驗證它**，不得重新向伺服器取資料。
驗證只證明某個狀態有人簽過，不證明它是使用者要操作的那一筆：伺服器若能回答新的 GET，就能換成另一筆簽章有效的紀錄，
讓瀏覽器把它簽成 `authored`。紀錄若已變動，誠實的伺服器會因 revision 不再相接而回 409。
這不擋回放：惡意伺服器一開始就顯示較舊但有效的版本，使用者操作後會產生該版本的新簽章（§7）。
寫入後的重讀必須與剛簽的 id、revision、簽章與密文完全相符，才算成功，以抓出被丟棄的寫入。這些規則集中在 `credentialService.writeNextState`。

解密後的內容也要檢查形狀（字串欄位）：簽章只證明誰簽的，而 `legacy-unverified` 紀錄可能在升級前就被植入，不能讓它破壞畫面。

永久刪除沒有 row 可以承載簽章，也無法證明；伺服器本來就能刪除資料（§7）。集合的 tombstone 因為保留 row，隨附件格式一併簽署。

### 4. Proof v2 簽署無狀態 nonce

`POST /auth/vault/challenge` 對已升級的 vault 回傳 nonce：

```text
nonce = base64url(random(16) | expiry_u64be | HMAC-SHA256(SECRET_KEY, domain | user_id | token_version | random | expiry))
X-Vault-Proof = "v2." + nonce + "." + base64url(ECDSA 簽章)
訊息 = JSON.stringify(["credential-vault/vault-proof", 2, nonce])
```

- 伺服器不存任何 proof 狀態。發出新 challenge 不會讓使用中的 proof 失效，因此多分頁互不干擾，
  只有 token 的人也無法靠要求 challenge 鎖住使用者。
- `token_version` 綁進 HMAC，登出即撤銷所有 proof。Proof 在 300 秒內可重複使用，客戶端拒絕低於 60 秒或超過 300 秒的期限。
- Proof v1 也不存每次 challenge 的狀態：`X-Vault-Proof = "v1." + ticket + "." + secret`，secret 由 HMAC 從 ticket 導出，以標籤化 OAEP 加密給 RSA 公鑰。
  RSA-only vault 必須升級才能解鎖，若 secret 每次改寫，偷到 token 的人只要不斷要求 challenge 就能擋住升級。
  HMAC 另混入每位使用者一把隨機金鑰（首次使用時產生、不再改寫、API 不回傳），所以只外洩 `SECRET_KEY` 無法偽造 proof 去替換 vault 金鑰。
  v1 只授權 `POST /auth/vault/upgrade`，不能用於其他路由。
- Proof domain 與紀錄簽章 domain 不同；客戶端只簽符合 `^[A-Za-z0-9_-]{32,128}$` 的 nonce，JSON 編碼是單射，所以伺服器拿不到可當紀錄簽章的訊息。
- 客戶端一旦持有簽章金鑰，就不再回應 proof v1；伺服器對已升級的 vault 也只接受 proof v2。

未採用原草案的「每 session 8 個 slots」：程式沒有 auth session ID，且把 challenge 限制在每 owner 5 次／分鐘，
偷到 token 的人就能耗盡配額，等於保留了原本要解決的鎖定問題。無狀態 nonce 不需要這些。

### 5. 附件按 4 KiB 分桶 padding

新附件 envelope v2 加密 `uint64_be(original_length) | original_bytes | random_padding`。
內文補至 4,096 bytes 的整數倍；最少一個 bucket。原始大小與檔名只在加密 manifest 內。
AAD 綁定 domain、附件版本、credential ID、field ID 與 attachment ID；DEK 每次新增／替換重建。
可見 envelope 大小為 padded plaintext 加 33 bytes；後端配額／稽核採可見密文大小。

此決策降低小型金鑰的精確長度辨識，仍會洩漏 bucket、附件數量、歸屬與時間模式。
集合 parent／membership 保持加密，是為避免直接公開關係圖，並不代表隱藏所有流量 metadata。
不加入假附件、隱藏存取流量或承諾全 vault 大小保密。

### 6. Legacy 資料與升級

原草案把舊資料標成 `legacy-unverified` 後仍可讀，但攻擊者只要用公鑰寫一筆 v2 格式的假紀錄，
它就會以「未驗證」的標籤顯示，簽章等於沒有擋下偽造。因此改為：

- **解鎖 RSA-only vault 時必須先完成一次性升級**，否則保持上鎖。App 不存在「已解鎖但無法簽章」的狀態。
- 升級由使用者明確確認，簽署當下所有紀錄的密文雜湊與狀態，並標 `origin = legacy-unverified`。
  這不宣稱舊資料真實，只固定「使用者在此刻接受的集合」；之後任何沒有簽章的紀錄都會被拒絕，而不只是被標示。
- 升級是原子的：`POST /auth/vault/upgrade` 在單一 transaction 內存入 bundle、簽章公鑰與涵蓋全部紀錄的簽章，
  涵蓋範圍或 revision 不符即 409 並回滾，不存在部分紀錄未簽章的狀態。只允許標 `legacy-unverified`。
- 使用者查看後可在明細頁確認來源，該紀錄才變成 `authored`。不做背景批次確認。
- Bundle 回滾：伺服器重放舊的 RSA-only blob 時，同一瀏覽器以 localStorage 標記拒絕升級。
  標記以「由已驗證私鑰導出的公鑰」的雜湊為鍵，不用 user id，因為伺服器可以改 user id 讓標記對不上。
  若紀錄已帶簽章也拒絕，但這個訊號可由伺服器抹除。新裝置或清除網站資料後無法偵測，只能靠升級提示讓使用者察覺（§7）。
- 伺服器也可能謊稱帳號還沒有 vault，讓畫面變成設定新 vault。設定畫面沒有金鑰可比對，因此只要瀏覽器曾解鎖過 vault 就顯示警告。
  這不會洩漏明文，新金鑰也打不開舊紀錄，主要是阻斷服務。
- 只有 RSA-only 的 blob 不能走密碼變更，以免伺服器重放舊金鑰後被重新包裝。
- 紀錄內容不接受未知 envelope 版本落入 v1 解析。`legacy-unverified` 的紀錄只能承載舊文字 map，附件格式實作時須拒絕其攜帶 sections、manifest 或 file 欄位。
- V1 `.cvault` 不含簽章，還原後一律標 `legacy-unverified`。V2 備份的加密 manifest 另保存來源簽章與來源標示。
- 新備份密碼至少 12 字元；提供以 CSPRNG 產生的 128-bit 以上復原秘密，建議另存。
  舊備份的讀取不套用新的最小長度，避免失去還原能力。

### 7. 信任邊界與發布 gate

在可信前端、未外洩 vault 密碼／私鑰的條件下，控制資料 API 的攻擊者不能解開秘密，
也不能建立可通過簽章驗證的紀錄或外部狀態。

E2EE 不防禦被替換的前端、解鎖中的 XSS、惡意擴充套件、拒絕服務、刪漏資料或回放舊版本。
回放是刻意保留的殘餘風險：伺服器能回傳某筆紀錄**較舊但簽章有效**的版本，例如撤銷前的狀態；使用者對它操作，還會產生更高 revision 的新簽章。
簽章證明誰寫了某個狀態，不證明它是最新的。只有本機記住見過的最大 revision 能抓到，但目前未實作，新裝置也無法憑單一伺服器證明最新狀態。
`created_at`／`updated_at` 不在簽章內，只作顯示。Dashboard 不解鎖 vault，其到期日未經驗證並有標示。
升級前已被植入的紀錄會被一併簽署並標 `legacy-unverified`，這就是標籤存在的原因。

附件格式（Phase 1）定案前仍需要：修補的成套部署證據，以及本 ADR 的獨立重審。

## Consequences

### Positive

- 明確區分資料保密、金鑰匹配、內容來源與外部狀態完整性。
- 不需重新加密既有資料；只有公鑰的偽造會被拒絕，而不是被標示。
- Proof 不再執行資料解密；無狀態設計消除 proof 欄位互相覆寫造成的鎖定與多分頁失敗。

### Negative

- 每次寫入都需要 proof 與簽章；舊前端無法寫入，部署後必須重新整理。
- 升級要求使用者一次性確認；需要處理回滾偵測與舊資料標籤。
- 舊資料來源無法事後憑加密補證，需保留可信程度與使用者核對流程。
- 上傳簽章受 nginx 預設 1 MiB body 限制，約可容納 5,000 筆紀錄；超過時升級會失敗，不會部分完成。

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
| 舊格式照常顯示並標未驗證 | 攻擊者寫舊格式即可繞過簽章，只多一個標籤，不採用 |
| 所有 legacy 資料在背景自動簽署 | 使用者沒有確認，也無法分辨來源標籤，不採用 |
| 簽章嵌在 blob 內、不加欄位 | 免 migration，但無法涵蓋 status 與 revision，之後還要再換格式，不採用 |
| 每 session 多槽的有狀態 proof | 需要不存在的 session ID，限流仍讓偷到 token 的人能鎖住使用者，不採用 |
| 不做 padding | 會公開精確檔案長度；本次選擇固定 bucket 並明示剩餘洩漏 |

## References

- [SPEC-004](../specs/SPEC-004-structured-credentials-and-attachments.md)、[PLAN-004](../plans/PLAN-004-structured-credentials-and-attachments.md)。
- [W3C Web Crypto](https://www.w3.org/TR/2017/REC-WebCryptoAPI-20170126/)（查閱：2026-11-05）。

---

*Created: 2026-11-05*
*Last updated: 2026-11-05*
