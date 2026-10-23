# Roadmap

> Long-term project planning and milestones.

## Vision

Credential Vault 是一個自託管的憑證管理系統，讓使用者安全地儲存和管理個人/團隊的帳密與憑證。透過 Tailscale 零信任存取、Google OAuth 身分驗證、零知識端對端加密，提供企業級的安全性。

---

## Milestones

### Phase 1: Foundation (Completed)

- [x] 專案初始化與架構設計
- [x] Backend API 結構 (FastAPI + SQLAlchemy)
- [x] 使用者認證系統 (Google OAuth + JWT；TOTP MFA 已停用)
- [x] 憑證 CRUD API
- [x] 後端加密模組
- [x] Tailscale VPN 整合
- [x] Frontend 基礎架構 (React + TypeScript + Vite)
- [x] 前端加密模組 (Web Crypto API)
- [x] Master Password 機制
- [x] Admin 角色管理 (bootstrap, promote, demote)
- [x] 使用者管理 API (reactivate, hard delete)
- [x] **純 Key-Value 憑證儲存結構** (重構完成)

### Phase 2: Template System (Completed)

- [x] Template 資料模型設計
- [x] 預設模板 (Google Account, OAuth, SSH, API Keys 等)
- [x] 自訂模板功能
- [x] 模板使用追蹤 (已用模板排序邏輯)
- [x] 前端模板選擇 UI
- [x] 模板欄位預填
- [x] 模板匯出/匯入功能
- [x] 後端 Template API (跨裝置同步)
- [x] localStorage → 後端自動遷移

### Phase 3: Enhancement (Current)

- [x] Alembic 資料庫遷移
- [ ] 密碼強度分析
- [ ] 憑證到期提醒
- [ ] 憑證分享 (團隊功能)
- [ ] 匯入/匯出功能 (CSV, JSON)
- [ ] 瀏覽器擴充套件

### Phase 4: Production Readiness

- [ ] Docker 部署優化
- [ ] 效能調優
- [ ] 監控與日誌
- [ ] 備份與還原策略
- [ ] 安全審計
- [ ] 使用者文件

---

## Future Considerations

- 行動裝置 App (React Native)
- WebAuthn / Passkey 支援
- 硬體安全金鑰整合 (YubiKey)
- 自動填入功能
- 密碼洩漏檢測 (Have I Been Pwned)

---

*Last updated: 2026-02-05*
