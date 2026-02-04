# SPEC-001: Template System

> Feature specification for credential templates.

**Status**: Implemented
**Author**: Claude
**Created**: 2025-02-05
**Updated**: 2025-02-05
**Related**: [PROGRESS.md](../../PROGRESS.md) WP-2, [PLAN-001](../plans/PLAN-001-template-system.md)

---

## Overview

Template 系統讓使用者從預設模板快速建立憑證，自動填入欄位名稱，提升使用體驗。使用者也可以建立自訂模板。

### Goals

1. **快速建立常用憑證類型** - 預設模板涵蓋常見服務
2. **減少重複輸入** - 自動填入欄位名稱和預設值
3. **個人化體驗** - 使用過的模板自動排序或隱藏
4. **可擴展性** - 使用者可建立自訂模板

### Non-Goals

- 模板不包含實際憑證值（只有欄位定義）
- 模板不在使用者間共享（每人獨立）
- 不支援模板版本控制
- 不支援 Admin 層級的資料庫匯出（僅個人匯出）

---

## Data Model

### Template Structure

```typescript
interface CredentialTemplate {
  id: string                    // 唯一識別碼
  name: string                  // 模板名稱 (e.g., "Google Account")
  description?: string          // 說明
  icon?: string                 // 圖示 (emoji or icon name)
  category?: string             // 分類 (e.g., "Social", "Development")
  fields: TemplateField[]       // 欄位定義
  isBuiltIn: boolean            // 是否為內建模板
  createdAt?: string            // 自訂模板的建立時間
}

interface TemplateField {
  key: string                   // 欄位名稱 (e.g., "Username")
  placeholder?: string          // 輸入提示
  isSecret: boolean             // 是否為敏感欄位
  required?: boolean            // 是否必填
  defaultValue?: string         // 預設值 (通常為空)
}
```

### Template Usage Tracking

```typescript
interface TemplateUsage {
  templateId: string
  usedAt: string               // ISO timestamp
  credentialId?: string        // 用此模板建立的憑證 ID
}
```

---

## Built-in Templates

### Login Templates

| Template | Fields |
|----------|--------|
| **Login (Basic)** | Username, Password |
| **Login (Email)** | Email, Password |
| **Login (Phone)** | Phone Number, Password, PIN |

### Google Templates

| Template | Fields |
|----------|--------|
| **Google Account** | Email, Password, Recovery Email, Recovery Phone |
| **Google OAuth** | Client ID, Client Secret, Redirect URI |
| **Google API Key** | API Key, Project ID |
| **Google Service Account** | Client Email, Private Key, Project ID |

### Development Templates

| Template | Fields |
|----------|--------|
| **API Keys** | API Key, API Secret |
| **OAuth 2.0** | Client ID, Client Secret, Token Endpoint, Scope |
| **SSH Key** | Username, Private Key, Passphrase, Host |
| **Database** | Host, Port, Database, Username, Password |
| **AWS Credentials** | Access Key ID, Secret Access Key, Region |
| **GitHub Token** | Personal Access Token, Username |

### Other Templates

| Template | Fields |
|----------|--------|
| **Credit Card** | Card Number, Expiry, CVV, Cardholder Name |
| **WiFi** | Network Name (SSID), Password, Security Type |
| **Server** | Host, Port, Username, Password, SSH Key |

---

## User Flows

### Flow 1: Create Credential from Template

```
1. 使用者點擊 "Add Credential"
2. 顯示 TemplateSelector 對話框
   - 顯示模板列表（分類顯示）
   - 已使用的模板排在最後或隱藏
   - 提供 "Start from Scratch" 選項
3. 使用者選擇模板
4. CredentialForm 開啟，欄位已預填
5. 使用者填入值並儲存
6. 記錄模板使用紀錄
```

### Flow 2: Create Custom Template

```
1. 使用者進入 Settings > Templates
2. 點擊 "Create Template"
3. 填入模板名稱、說明
4. 新增欄位（名稱 + isSecret）
5. 儲存模板
6. 模板出現在 TemplateSelector
```

### Flow 3: Create Template from Existing Credential

```
1. 使用者在 CredentialDetail 點擊 "Save as Template"
2. 系統擷取欄位名稱（不含值）
3. 使用者編輯模板名稱
4. 儲存為新模板
```

---

## UI Components

### TemplateSelector

位置: `frontend/src/components/TemplateSelector.tsx`

```
┌─────────────────────────────────────────┐
│ Choose a Template            [×]        │
├─────────────────────────────────────────┤
│ 🔍 Search templates...                  │
├─────────────────────────────────────────┤
│ DEVELOPMENT                             │
│ ┌─────────┐ ┌─────────┐ ┌─────────┐    │
│ │ 🔑 API  │ │ 🔐 OAuth│ │ 💻 SSH  │    │
│ │ Keys    │ │ 2.0     │ │ Key     │    │
│ └─────────┘ └─────────┘ └─────────┘    │
│                                         │
│ GOOGLE                                  │
│ ┌─────────┐ ┌─────────┐ ┌─────────┐    │
│ │ 📧 Gmail│ │ 🔧 OAuth│ │ 🔑 API  │    │
│ │ Account │ │         │ │ Key     │    │
│ └─────────┘ └─────────┘ └─────────┘    │
│                                         │
│ RECENTLY USED (or hidden)               │
│ ...                                     │
├─────────────────────────────────────────┤
│ [Start from Scratch]                    │
└─────────────────────────────────────────┘
```

### TemplateManager (Settings)

位置: `frontend/src/components/TemplateManager.tsx`

- 列出所有自訂模板
- 編輯/刪除模板
- 建立新模板

---

## Storage Strategy

### Option A: Frontend Only (Recommended for Phase 2)

- 內建模板: 硬編碼在 `frontend/src/data/templates.ts`
- 自訂模板: 儲存在 `localStorage`
- 使用紀錄: 儲存在 `localStorage`

**Pros**: 簡單、無需後端改動
**Cons**: 換裝置時自訂模板不同步

### Option B: Backend Storage (Future)

- 新增 `templates` 表
- API: `GET/POST/PUT/DELETE /api/v1/templates`
- 使用紀錄儲存在後端

**Pros**: 跨裝置同步
**Cons**: 需要後端改動、資料庫遷移

### Decision

**Phase 2 採用 Option A**，未來 Phase 3+ 可遷移到 Option B。

---

## Export/Import Feature

### Overview

使用者可將自訂模板匯出為加密檔案，儲存至 Google Drive 或其他雲端空間，並可在其他裝置/瀏覽器匯入還原。

### Export Flow

```
1. 使用者進入 Settings > Templates > Export
2. 系統顯示匯出對話框
3. 預設勾選「Use Master Password」
   - 勾選時：直接使用記憶體中的 Master Password
   - 取消勾選：使用者輸入自訂匯出密碼
4. 系統以此密碼加密模板資料
5. 下載加密檔案（*.cvault）
6. 提示使用者上傳至 Google Drive 等雲端（手動）
```

### Import Flow

```
1. 使用者進入 Settings > Templates > Import
2. 選擇匯入檔案（*.cvault）
3. 輸入密碼：
   - 提供「Try Master Password」按鈕（自動嘗試目前的 Master Password）
   - 或手動輸入匯出時設定的密碼
4. 系統解密並驗證
5. 如有衝突（同名模板），提示處理方式：
   - Skip: 跳過已存在的
   - Replace: 覆蓋現有的
   - Keep Both: 保留兩者（匯入的加 suffix）
6. 匯入完成，顯示結果摘要
```

### File Format

```typescript
// 匯出檔案結構（.cvault）
interface ExportFile {
  version: 1                    // 格式版本（明文，用於相容性檢查）
  exportedAt: string            // ISO timestamp（明文）
  encryptedData: string         // Base64 encoded AES-256-GCM encrypted data
  salt: string                  // PBKDF2 salt（明文）
  iv: string                    // AES IV（明文）
}

// encryptedData 解密後
interface ExportedData {
  customTemplates: CredentialTemplate[]
  templateUsage: TemplateUsage[]
}
```

### Encryption Details

- **Key Derivation**: PBKDF2-SHA256, 100,000 iterations
- **Encryption**: AES-256-GCM（提供加密 + 完整性驗證）
- **密碼**: 使用者自訂，獨立於 Master Password

### Security Notes

- 預設使用 Master Password 加密，方便大多數使用者
- 進階使用者可選擇獨立密碼（換 Master Password 後舊備份仍可用）
- 系統不儲存匯出密碼，僅在加密時使用
- 忘記自訂密碼無法恢復，需重新匯出
- 若使用 Master Password 匯出，換 Master Password 後需重新匯出

---

## Implementation Plan

### Step 1: Template Data & Types

1. 建立 `frontend/src/types/template.ts`
2. 建立 `frontend/src/data/templates.ts` (內建模板)
3. 建立 `frontend/src/lib/templateStorage.ts` (localStorage 操作)

### Step 2: TemplateSelector Component

1. 建立 `frontend/src/components/TemplateSelector.tsx`
2. 實作搜尋、分類顯示
3. 實作使用紀錄排序

### Step 3: Integration

1. 修改 `CredentialsPage.tsx` - 新增時顯示 TemplateSelector
2. 修改 `CredentialForm.tsx` - 接收 template 參數預填欄位

### Step 4: Template Management

1. 建立 `frontend/src/pages/SettingsPage.tsx` 的 Templates 區塊
2. 建立 `frontend/src/components/TemplateManager.tsx`
3. 實作自訂模板 CRUD

### Step 5: Testing & Documentation

1. 單元測試
2. 更新 docs

---

## API (Future - Option B)

如果未來遷移到後端儲存：

```
GET    /api/v1/templates           # 列出所有模板
POST   /api/v1/templates           # 建立模板
GET    /api/v1/templates/{id}      # 取得模板
PUT    /api/v1/templates/{id}      # 更新模板
DELETE /api/v1/templates/{id}      # 刪除模板

POST   /api/v1/templates/{id}/use  # 記錄使用
```

---

## Testing Considerations

- 內建模板完整性測試
- localStorage 讀寫測試
- 模板選擇 UI 測試
- 欄位預填測試
- 使用紀錄排序測試

---

## Open Questions (Resolved)

| # | Question | Decision | Rationale |
|---|----------|----------|-----------|
| 1 | 使用過的模板處理方式 | **排最後 + 顯示使用次數** | 完全隱藏會讓用戶困惑；顯示次數讓用戶了解使用模式 |
| 2 | 模板圖示 | **使用 Emoji** | 簡單、跨平台、無額外依賴 |
| 3 | 匯出/匯入模板 | **支援（個人層級）** | 使用者可備份至 Google Drive，使用獨立密碼加密 |

---

*Last updated: 2025-02-05*
