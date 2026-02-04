# SPEC-002: Backend Template API

> Feature specification for backend template storage and cross-device sync.

**Status**: Draft
**Author**: Claude
**Created**: 2025-02-05
**Updated**: 2025-02-05
**Related**: [SPEC-001](SPEC-001-template-system.md), [PLAN-002](../plans/PLAN-002-backend-template-api.md)

---

## Overview

Phase 3 將自訂模板從 localStorage 遷移至後端資料庫，實現跨裝置同步。內建模板仍保留在前端硬編碼。

### Goals

1. **跨裝置同步** - 自訂模板在所有裝置上保持一致
2. **資料持久化** - 清除瀏覽器資料不會遺失模板
3. **版本衝突處理** - 多裝置同時編輯時的安全處理
4. **無縫遷移** - 現有 localStorage 模板自動遷移到後端

### Non-Goals

- 內建模板的後端管理（保持前端硬編碼）
- Admin 層級的模板管理
- 模板共享（使用者間）
- 離線優先架構（Phase 3 假設有網路連線）

---

## Data Model

### Template Table

```sql
CREATE TABLE templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- Metadata
    name VARCHAR(255) NOT NULL,
    description TEXT,
    icon VARCHAR(50),           -- Emoji or icon name
    category VARCHAR(50),       -- e.g., "development", "login"

    -- Fields Definition (plaintext JSON)
    fields JSONB NOT NULL,      -- Array of TemplateField

    -- Sync & Status
    sync_version INTEGER NOT NULL DEFAULT 1,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,

    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- Constraints
    CONSTRAINT unique_template_name_per_user UNIQUE (owner_id, name)
);

CREATE INDEX idx_templates_owner_id ON templates(owner_id);
CREATE INDEX idx_templates_category ON templates(category);
```

### Template Usage Table

```sql
CREATE TABLE template_usage (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id UUID NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    credential_id UUID REFERENCES credentials(id) ON DELETE SET NULL,
    used_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    CONSTRAINT unique_usage_per_credential UNIQUE (template_id, credential_id)
);

CREATE INDEX idx_template_usage_template_id ON template_usage(template_id);
CREATE INDEX idx_template_usage_user_id ON template_usage(user_id);
```

### Fields JSON Structure

```typescript
// fields 欄位儲存的 JSON 結構（明文）
interface TemplateField {
  key: string           // 欄位名稱
  placeholder?: string  // 輸入提示
  isSecret: boolean     // 是否為敏感欄位
  required?: boolean    // 是否必填
  defaultValue?: string // 預設值（通常為空）
}

// Example:
[
  { "key": "username", "isSecret": false, "required": true },
  { "key": "password", "isSecret": true, "required": true },
  { "key": "notes", "isSecret": false }
]
```

---

## API Endpoints

### Template CRUD

```
GET    /api/v1/templates              # 列出使用者的所有模板
POST   /api/v1/templates              # 建立新模板
GET    /api/v1/templates/{id}         # 取得單一模板
PATCH  /api/v1/templates/{id}         # 更新模板（需帶 sync_version）
DELETE /api/v1/templates/{id}         # 刪除模板
```

### Template Usage

```
POST   /api/v1/templates/{id}/use     # 記錄使用（可選帶 credential_id）
GET    /api/v1/templates/usage        # 取得使用統計
```

### Sync & Migration

```
POST   /api/v1/templates/sync         # 批次同步（從 localStorage 遷移）
```

---

## API Details

### GET /api/v1/templates

列出使用者的所有自訂模板。

**Query Parameters**:
- `category` (optional): 過濾類別
- `include_inactive` (optional, default: false): 包含已刪除的模板

**Response** (200 OK):
```json
{
  "templates": [
    {
      "id": "uuid",
      "name": "My API Template",
      "description": "Custom API credentials",
      "icon": "🔑",
      "category": "development",
      "fields": [...],
      "sync_version": 3,
      "is_active": true,
      "created_at": "2025-02-05T10:00:00Z",
      "updated_at": "2025-02-05T12:00:00Z"
    }
  ],
  "total": 5
}
```

### POST /api/v1/templates

建立新模板。

**Request Body**:
```json
{
  "name": "My API Template",
  "description": "Custom API credentials",
  "icon": "🔑",
  "category": "development",
  "fields": [
    { "key": "api_key", "isSecret": true, "required": true },
    { "key": "endpoint", "isSecret": false }
  ]
}
```

**Response** (201 Created):
```json
{
  "id": "uuid",
  "name": "My API Template",
  "sync_version": 1,
  ...
}
```

**Errors**:
- `409 Conflict`: 同名模板已存在

### PATCH /api/v1/templates/{id}

更新模板。需帶 `sync_version` 做樂觀鎖定。

**Request Body**:
```json
{
  "name": "Updated Name",
  "fields": [...],
  "sync_version": 3
}
```

**Response** (200 OK):
```json
{
  "id": "uuid",
  "name": "Updated Name",
  "sync_version": 4,
  ...
}
```

**Errors**:
- `404 Not Found`: 模板不存在或不屬於此使用者
- `409 Conflict`: 版本衝突（伺服器版本 != 請求版本）

**Version Conflict Response** (409):
```json
{
  "detail": "Version conflict",
  "server_version": 5,
  "client_version": 3,
  "server_data": { ... }  // 目前伺服器上的資料
}
```

### DELETE /api/v1/templates/{id}

刪除模板（軟刪除，設定 `is_active = false`）。

**Query Parameters**:
- `hard_delete` (optional, default: false): 永久刪除

**Response** (204 No Content)

### POST /api/v1/templates/{id}/use

記錄模板使用。

**Request Body** (optional):
```json
{
  "credential_id": "uuid"  // 用此模板建立的憑證
}
```

**Response** (200 OK):
```json
{
  "template_id": "uuid",
  "use_count": 5
}
```

### GET /api/v1/templates/usage

取得使用統計。

**Response** (200 OK):
```json
{
  "usage": [
    {
      "template_id": "uuid",
      "template_name": "My API Template",
      "use_count": 5,
      "last_used_at": "2025-02-05T12:00:00Z"
    }
  ]
}
```

### POST /api/v1/templates/sync

批次同步（用於 localStorage 遷移）。

**Request Body**:
```json
{
  "templates": [
    {
      "local_id": "custom-abc123",  // localStorage 中的 ID
      "name": "My Template",
      "fields": [...],
      "created_at": "2025-02-01T10:00:00Z"
    }
  ],
  "usage": [
    {
      "local_template_id": "custom-abc123",
      "used_at": "2025-02-05T10:00:00Z"
    }
  ]
}
```

**Response** (200 OK):
```json
{
  "synced": 3,
  "skipped": 1,  // 同名已存在
  "mapping": {
    "custom-abc123": "server-uuid-1",
    "custom-def456": "server-uuid-2"
  }
}
```

---

## Authorization

所有端點都需要認證（JWT Token）。

| Endpoint | Authorization |
|----------|---------------|
| All template endpoints | `CurrentUser` - 只能存取自己的模板 |

**Ownership Check**:
- 所有 GET/PATCH/DELETE 操作都檢查 `template.owner_id == current_user.id`
- 違反時回傳 `404 Not Found`（不洩漏其他使用者的模板存在）

---

## Sync Strategy

### Migration Flow (localStorage → Backend)

```
1. 使用者登入成功
2. 前端檢查 localStorage 是否有自訂模板
3. 前端呼叫 GET /api/v1/templates 檢查後端是否為空
4. 如果後端為空且本地有資料：
   a. 呼叫 POST /api/v1/templates/sync 批次上傳
   b. 清除 localStorage 中的模板資料
   c. 顯示「模板已同步到雲端」提示
5. 如果後端有資料：
   a. 使用後端資料
   b. 忽略 localStorage（或提示使用者選擇）
```

### Conflict Resolution (Optimistic Locking)

```
1. 使用者開啟模板編輯
2. 前端記住當前 sync_version
3. 使用者修改並儲存
4. 前端發送 PATCH 請求，帶上 sync_version
5. 後端檢查版本：
   a. 版本相符 → 更新成功，sync_version++
   b. 版本不符 → 回傳 409 Conflict + 伺服器最新資料
6. 前端收到 409 時：
   a. 顯示衝突對話框
   b. 讓使用者選擇：使用伺服器版本 / 覆蓋伺服器 / 取消
```

---

## Frontend Changes

### New/Modified Files

| File | Change |
|------|--------|
| `frontend/src/lib/api/templates.ts` | 新增：Template API 客戶端 |
| `frontend/src/hooks/useTemplates.ts` | 新增：Template data hook (React Query) |
| `frontend/src/lib/templateStorage.ts` | 修改：加入 migration 邏輯 |
| `frontend/src/components/TemplateSelector.tsx` | 修改：使用後端資料 |
| `frontend/src/components/TemplateManager.tsx` | 修改：使用後端 API |

### API Client Pattern

```typescript
// frontend/src/lib/api/templates.ts
import { api } from './client'

export const templateApi = {
  list: (params?: { category?: string }) =>
    api.get<TemplateListResponse>('/templates', { params }),

  create: (data: TemplateCreate) =>
    api.post<TemplateRead>('/templates', data),

  update: (id: string, data: TemplateUpdate) =>
    api.patch<TemplateRead>(`/templates/${id}`, data),

  delete: (id: string) =>
    api.delete(`/templates/${id}`),

  recordUsage: (id: string, credentialId?: string) =>
    api.post(`/templates/${id}/use`, { credential_id: credentialId }),

  sync: (data: SyncRequest) =>
    api.post<SyncResponse>('/templates/sync', data),
}
```

### React Query Hook

```typescript
// frontend/src/hooks/useTemplates.ts
export function useTemplates() {
  return useQuery({
    queryKey: ['templates'],
    queryFn: () => templateApi.list(),
  })
}

export function useCreateTemplate() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: templateApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['templates'] })
    },
  })
}
```

---

## Error Handling

| Status | Meaning | Client Action |
|--------|---------|---------------|
| 400 | Bad Request | 顯示驗證錯誤 |
| 401 | Unauthorized | 重新登入 |
| 404 | Not Found | 模板可能已刪除，重新載入列表 |
| 409 | Conflict (name) | 提示「模板名稱已存在」 |
| 409 | Conflict (version) | 顯示衝突對話框 |
| 500 | Server Error | 顯示錯誤，建議重試 |

---

## Security Considerations

1. **所有權驗證** - 每個請求都檢查 owner_id
2. **輸入驗證** - 限制 name 長度、fields 數量
3. **Rate Limiting** - 同現有 API 限制
4. **No Sensitive Data** - 模板不儲存實際密碼/金鑰

---

## Testing Strategy

### Unit Tests (Backend)

- TemplateService CRUD operations
- Ownership verification
- Version conflict detection
- Sync/migration logic

### Integration Tests (Backend)

- API endpoint responses
- Database constraints (unique name per user)
- Cascade delete behavior

### Frontend Tests

- API client functions
- React Query hooks
- Migration flow
- Conflict resolution UI

---

## Open Questions

| # | Question | Status |
|---|----------|--------|
| 1 | 是否需要模板「分享」功能？ | Deferred to future phase |
| 2 | 離線支援（Service Worker）？ | Deferred to future phase |

---

*Last updated: 2025-02-05*
