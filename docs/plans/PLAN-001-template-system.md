# PLAN-001: Template System

> Implementation Plan for Phase 2 - Template System with Export/Import

## Metadata

| Field | Value |
|-------|-------|
| **Status** | Completed |
| **Owner** | Unassigned |
| **Assigned To** | Claude |
| **Reviewer** | TBD |

## Related Spec

[SPEC-001: Template System](../specs/SPEC-001-template-system.md)

## Overview

Phase 2 實作模板系統，讓使用者從預設模板快速建立憑證。包含：
- 內建模板（18+ 種常用服務）
- 自訂模板（CRUD）
- 模板使用追蹤（排序優化）
- **匯出/匯入功能**（加密備份至 Google Drive 等雲端）

儲存策略：Phase 2 使用 localStorage（前端），Phase 3+ 可遷移至後端。

---

## Implementation Phases

### Phase 2.1: Types & Data Foundation

- [ ] Task 1.1: 建立 `frontend/src/types/template.ts` - TypeScript interfaces
- [ ] Task 1.2: 建立 `frontend/src/data/templates.ts` - 內建模板資料（18+ templates）
- [ ] Task 1.3: 建立 `frontend/src/lib/templateStorage.ts` - localStorage 工具函式
- [ ] Task 1.4: 建立 `frontend/src/lib/templateExport.ts` - 匯出/匯入加密邏輯

**Deliverables**:
- Template 型別定義完成
- 內建模板資料可用
- localStorage CRUD 函式可用
- 匯出加密函式可用

### Phase 2.2: TemplateSelector Component

- [ ] Task 2.1: 建立 `frontend/src/components/TemplateSelector.tsx`
- [ ] Task 2.2: 實作模板分類顯示（Development, Google, Login, etc.）
- [ ] Task 2.3: 實作搜尋/過濾功能
- [ ] Task 2.4: 實作使用紀錄追蹤與排序（已用模板排最後 + 顯示使用次數）
- [ ] Task 2.5: 實作「Start from Scratch」選項

**Deliverables**:
- TemplateSelector 元件可獨立運作
- 可選擇模板或從頭開始

### Phase 2.3: Integration with CredentialForm

- [ ] Task 3.1: 修改 `CredentialForm.tsx` - 新增 `template` prop
- [ ] Task 3.2: 實作 `templateToFields()` 函式
- [ ] Task 3.3: 修改 `CredentialsPage.tsx` - 新增按鈕開啟 TemplateSelector
- [ ] Task 3.4: 實作選擇模板後開啟 CredentialForm 並預填欄位
- [ ] Task 3.5: 儲存憑證後記錄模板使用紀錄

**Deliverables**:
- 使用者可從模板建立憑證
- 欄位自動預填
- 使用紀錄正確追蹤

### Phase 2.4: Template Management (Settings)

- [ ] Task 4.1: 修改 `SettingsPage.tsx` - 新增 Templates 區塊
- [ ] Task 4.2: 建立 `frontend/src/components/TemplateManager.tsx`
- [ ] Task 4.3: 實作自訂模板 CRUD（新增、編輯、刪除）
- [ ] Task 4.4: 實作「從現有憑證建立模板」功能
- [ ] Task 4.5: 實作內建模板檢視（唯讀）

**Deliverables**:
- 使用者可管理自訂模板
- 可從憑證建立新模板

### Phase 2.5: Export/Import Feature

- [ ] Task 5.1: 設計匯出檔案格式（JSON + AES-256-GCM 加密）
- [ ] Task 5.2: 建立 `frontend/src/components/ExportImportDialog.tsx`
- [ ] Task 5.3: 實作匯出功能 - 用戶輸入匯出密碼 → 加密 → 下載檔案
- [ ] Task 5.4: 實作匯入功能 - 上傳檔案 → 輸入密碼 → 解密 → 合併模板
- [ ] Task 5.5: 處理匯入衝突（同名模板的處理策略）
- [ ] Task 5.6: 新增「儲存至 Google Drive」提示（Phase 2 僅下載，提示用戶手動上傳）

**Deliverables**:
- 使用者可匯出加密備份檔
- 使用者可匯入備份並還原模板
- 明確的安全性說明

### Phase 2.6: Testing & Documentation

- [ ] Task 6.1: 單元測試 - template types & utilities
- [ ] Task 6.2: 單元測試 - localStorage operations
- [ ] Task 6.3: 單元測試 - export/import encryption
- [ ] Task 6.4: 整合測試 - TemplateSelector + CredentialForm flow
- [ ] Task 6.5: 整合測試 - Export/Import round-trip
- [ ] Task 6.6: 更新 `docs/` 相關文件

**Deliverables**:
- 測試覆蓋率達標
- 文件更新完成

---

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `frontend/src/types/template.ts` | Create | Template 相關型別定義 |
| `frontend/src/data/templates.ts` | Create | 內建模板資料（18+） |
| `frontend/src/lib/templateStorage.ts` | Create | localStorage CRUD 工具 |
| `frontend/src/lib/templateExport.ts` | Create | 匯出/匯入加密邏輯 |
| `frontend/src/components/TemplateSelector.tsx` | Create | 模板選擇器元件 |
| `frontend/src/components/TemplateManager.tsx` | Create | 模板管理元件 |
| `frontend/src/components/ExportImportDialog.tsx` | Create | 匯出匯入對話框 |
| `frontend/src/components/CredentialForm.tsx` | Modify | 新增 template prop |
| `frontend/src/pages/CredentialsPage.tsx` | Modify | 整合 TemplateSelector |
| `frontend/src/pages/SettingsPage.tsx` | Modify | 新增 Templates 區塊 |
| `frontend/src/tests/template.test.ts` | Create | Template 相關測試 |

---

## Technical Decisions

### TD-1: 匯出密碼策略

**選擇**: 預設使用 Master Password，可選自訂密碼

**實作**:
- UI 預設勾選「Use Master Password」
- 透過 `useMasterPasswordStore.getMasterPassword()` 取得記憶體中的 master password
- 用戶可取消勾選，改用自訂密碼
- 無論哪種方式，都用相同的 AES-256-GCM 加密流程

**理由**:
- 懶人友善：大多數用戶不想記另一組密碼
- 彈性保留：進階用戶可選擇獨立密碼（換 master password 後舊備份仍可用）
- 技術可行：前端記憶體中已有 master password

### TD-2: 匯出檔案格式

**選擇**: JSON + AES-256-GCM 加密

```typescript
interface ExportFile {
  version: 1                    // 格式版本（明文）
  exportedAt: string            // ISO timestamp（明文）
  encryptedData: string         // Base64 encoded encrypted JSON
  salt: string                  // PBKDF2 salt（明文）
  iv: string                    // AES IV（明文）
}

// encryptedData 解密後的結構
interface ExportedTemplates {
  customTemplates: CredentialTemplate[]
  templateUsage: TemplateUsage[]
}
```

**理由**:
- AES-256-GCM 提供加密 + 完整性驗證
- PBKDF2 從密碼衍生金鑰，防止暴力破解
- 明文 metadata 方便檢查版本相容性

### TD-3: 模板 ID 命名規則

**選擇**: Prefix 區分內建與自訂

- 內建模板: `builtin-{category}-{name}` (e.g., `builtin-dev-api-keys`)
- 自訂模板: `custom-{uuid}` (e.g., `custom-a1b2c3d4`)

**理由**: 避免 ID 碰撞，方便識別來源

### TD-4: 已使用模板的顯示方式

**選擇**: 排最後 + 顯示使用次數

**理由**: 不完全隱藏避免用戶困惑，顯示次數讓用戶了解使用模式

### TD-5: 匯入衝突處理

**選擇**: 提供三個選項讓用戶選擇

1. **Skip** - 跳過已存在的模板
2. **Replace** - 用匯入的覆蓋現有
3. **Keep Both** - 保留兩者（匯入的加上 `(imported)` 後綴）

---

## Testing Strategy

### Unit Tests

- `templateStorage.ts`: CRUD operations, edge cases (empty, max capacity)
- `templateExport.ts`: encrypt/decrypt round-trip, invalid password, corrupted data
- `templates.ts`: 驗證所有內建模板結構正確

### Integration Tests

- TemplateSelector → CredentialForm: 選擇模板後欄位正確預填
- Export → Import: 完整 round-trip 測試
- TemplateManager: CRUD 操作後 localStorage 狀態正確

### Manual Testing Checklist

- [ ] 選擇內建模板建立憑證
- [ ] 建立自訂模板並使用
- [ ] 從現有憑證建立模板
- [ ] 匯出模板（檢查檔案內容已加密）
- [ ] 匯入模板（正確密碼）
- [ ] 匯入模板（錯誤密碼 → 應顯示錯誤）
- [ ] 匯入衝突處理（三種選項都測試）
- [ ] 清除瀏覽器資料後匯入還原

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| localStorage 容量限制（~5MB） | Medium | 加入容量檢查，超過時警告用戶並建議匯出 |
| 用戶忘記自訂匯出密碼 | Medium | 預設使用 Master Password；選自訂密碼時明確提示 |
| 用戶換 Master Password 後舊備份失效 | Medium | UI 提示「換密碼後請重新匯出」；進階用戶可用自訂密碼 |
| 瀏覽器清除資料遺失模板 | Medium | 定期提示用戶匯出備份；UI 顯示「僅存於此瀏覽器」 |
| 匯入檔案格式不相容 | Low | 檔案包含 version 欄位，可做向後相容處理 |
| 模板 ID 碰撞 | Low | 使用 prefix 區分 + UUID 生成 |

---

## Open Questions (Resolved)

| # | Question | Decision |
|---|----------|----------|
| 1 | 使用過的模板處理方式 | 排最後 + 顯示使用次數 |
| 2 | 模板圖示 | 使用 Emoji |
| 3 | 匯出/匯入支援 | Phase 2 實作，使用獨立密碼加密 |

---

## Progress Log

| Date | Update |
|------|--------|
| 2025-02-05 | Plan created |
| 2025-02-05 | Phase 2.1 completed - Types & Data Foundation |
| 2025-02-05 | Phase 2.2 completed - TemplateSelector Component |
| 2025-02-05 | Phase 2.3 completed - Integration with CredentialForm |
| 2025-02-05 | Phase 2.4 completed - Template Management (Settings) |
| 2025-02-05 | Phase 2.5 completed - Export/Import Feature |
| 2025-02-05 | Phase 2.6 completed - Testing & Documentation |
| 2025-02-05 | **Phase 2 COMPLETED** |

---

*Created: 2025-02-05*
*Author: Claude*
