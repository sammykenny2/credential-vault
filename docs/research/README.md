# Research index

Updated: 2026-10-23.

## Entries

- [儲存與認證面安全審查](2026-10-23-security-review-storage-and-auth-surface.md): 全專案靜態審查。E2EE 儲存本體正確；高風險在伺服器端密碼產生、前端無 CSP 與 localStorage token、WebAuthn 半成品、依賴漏洞與 CI 不擋。含修復順序與未驗證事項。

## Conventions

- 檔名：`YYYY-MM-DD-kebab-case-title.md`，日期為研究或審查的基準日。
- 每篇開頭用條列記錄：日期與基準 commit、使用者請求、性質（靜態審查、官方文件查證、實測）、相關 ADR/SPEC。
- 結論依賴外部 API 或協定時，引用有日期的一手來源；工具輸出要註明執行日期。
- 文件只記錄發現與建議，不代表已修復；修復進度寫在文末「處理狀態」並連到 commit 或 ADR。
