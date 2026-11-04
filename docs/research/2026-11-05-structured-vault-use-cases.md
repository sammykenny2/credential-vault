# 結構化憑證與加密附件的使用情境

- 日期／基準：2026-11-05，程式碼基準 `2d41d37`。
- 使用者請求：評估檔案型 credential，以及 Apple、Android、Windows 簽署、GCP、Cloudflare、GenAI 的 grouping 需求，建立 ADR／SPEC／PLAN。
- 性質：靜態程式碼檢視與官方文件查證；沒有讀取實際憑證、執行遷移或驗證執行中的服務。
- 相關文件：[ADR-003](../decisions/003-structured-credentials-and-attachments.md)、[SPEC-004](../specs/SPEC-004-structured-credentials-and-attachments.md)、[PLAN-004](../plans/PLAN-004-structured-credentials-and-attachments.md)。

## 現況證據

| 位置 | 觀察 |
|------|------|
| `frontend/src/lib/crypto.ts` | `fields` 是文字 map；credential blob v2 已綁定 credential ID，KDF version 為 2 |
| `frontend/src/components/CredentialForm.tsx`、`CredentialDetail.tsx` | 欄位值保存時沒有保留 `isSecret`，顯示依欄位名稱猜測 |
| `frontend/src/types/template.ts`、`app/schemas/template.py` | 平面 template 欄位；template 定義不是 E2EE 秘密容器 |
| `frontend/src/pages/CredentialsPage.tsx` | 清單取得密文後逐筆解密；附件不宜隨清單載入 |
| `app/schemas/credential.py` | 每筆 `encrypted_data` 限 1,000,000 字元 |
| `frontend/src/lib/credentialBackup.ts`、`CredentialBackupDialog.tsx` | v1 為整份 JSON 加密，匯出來源為傳入的 decrypted cache，沒有附件協定 |
| `frontend/src/services/credentialService.ts` | 保存後重讀；更新驗證失敗會回寫舊密文，需改為有 revision 的處理 |
| `app/maintenance.py` | NAS／維護工具使用 SQLite online backup；BLOB 同庫可納入 snapshot |

## 一手來源

以下查閱日期皆為 2026-11-05。表中的產品結構來自官方文件；如何拆分紀錄與群組是本專案的設計推論。

| 來源 | 可用於設計的事實 | 設計推論 |
|------|------------------|----------|
| [Apple：App Store Connect API keys](https://developer.apple.com/documentation/appstoreconnectapi/creating-api-keys-for-app-store-connect-api) | API key 具有識別資訊、私鑰與角色；存在 team／individual key 的區別 | Key 成為獨立紀錄，相關欄位與 `.p8` 放在同筆；用關聯描述共用背景 |
| [Android：Sign your app](https://developer.android.com/studio/publish/app-signing) | App signing key 與 upload key 的用途不同；keystore、alias 與密碼是不同材料 | 支援檔案與密碼成組，以及可重複的 key section；不可一律要求下載 Google 管理的私鑰 |
| [Microsoft：SignTool](https://learn.microsoft.com/en-us/dotnet/framework/tools/signtool-exe) | 簽署可指定憑證檔，或 provider／key container，並可設定 timestamp | 模板需容納檔案型與外部管理的金鑰位置，不強制每筆都有私鑰附件 |
| [Google Cloud：Authentication](https://docs.cloud.google.com/docs/authentication) | API key、OAuth client、service account 為不同類型的認證材料 | Project 作為集合；不同 credential 分筆，保留各自用途與生命週期 |
| [Cloudflare：Create tokens via API](https://developers.cloudflare.com/fundamentals/api/how-to/create-via-api/) | Token policy 組合 permissions 與 resources | 支援可重複的規則群組，維持權限與適用資源的配對 |
| [Claude：Workspaces](https://platform.claude.com/docs/en/manage-claude/workspaces) | API key 與 workspace 有範圍關係 | GenAI 模板保存 provider、endpoint 與 workspace／project 背景，避免只剩 token 字串 |
| [OWASP：File Upload](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html) | 大小、檔名、權限、儲存位置與外部掃描服務資料洩漏需要控制 | 只接收密文、不建立公開檔案路徑、不解析秘密檔案；副檔名不能成為安全保證 |
| [W3C：Web Crypto AES-GCM](https://www.w3.org/TR/2017/REC-WebCryptoAPI-20170126/#aes-gcm) | AES-GCM 支援 additional authenticated data 並驗證 authentication tag | 附件用新的金鑰與 IV，AAD 綁定穩定 ID；所有身分均來自已驗證的 manifest |

## 判斷與限制

- 集合階層、一層可重複 section 與紀錄關聯可容納上述案例；任意深度的紀錄內巢狀尚非必要。
- 常用欄位與原始檔案可並存；本次不解析廠商 JSON，也不驗證憑證是否可供外部服務實際使用。
- E2EE 後端不能替明文內容掃毒；不得以送往第三方掃描服務作為預設補救。
- AAD 提供內容與身分的綁定，不是作者簽章；惡意前端與整份快照的惡意回放需要另行處理。
- 附件配額、保留時間與集合深度是本專案的初版設計值，並非上述平台的限制。

## 處理狀態

2026-11-05：整理為待審閱的 ADR／SPEC／PLAN。尚未實作、遷移或執行效能及動態安全測試。
