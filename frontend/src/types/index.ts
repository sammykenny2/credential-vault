// User types
export type UserRole = 'user' | 'admin'

export interface User {
  id: string
  email: string
  display_name: string
  role: UserRole
  mfa_enabled: boolean
  is_active: boolean
  created_at: string
  last_login_at: string | null
}

export interface UserCreate {
  email: string
  display_name: string
  password: string
}

// Auth types
export interface LoginRequest {
  username: string // OAuth2 form uses 'username' field
  password: string
}

export interface TokenResponse {
  access_token: string
  refresh_token: string
  token_type: string
}

export interface MFASetup {
  secret: string
  provisioning_uri: string
  qr_code_base64: string
}

// Credential types
export interface Credential {
  id: string
  name: string
  description: string | null
  website_url: string | null
  category: string | null
  encrypted_data: string
  is_active: boolean
  revoked_at: string | null
  created_at: string
  updated_at: string
}

export interface CredentialListItem {
  id: string
  name: string
  description: string | null
  website_url: string | null
  category: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface CredentialCreate {
  name: string
  description?: string
  website_url?: string
  category?: string
  encrypted_data: string
}

export interface CredentialData {
  username?: string
  password?: string
  notes?: string
  custom_fields?: Record<string, string>
}

// API Response types
export interface ApiError {
  detail: string
}

// Template types (re-export from template.ts)
export type {
  FieldValidation,
  TemplateField,
  TemplateCategory,
  CredentialTemplate,
  TemplateUsage,
  TemplateUsageStats,
  ExportFile,
  ExportedData,
  ImportConflictStrategy,
  ImportResult,
  TemplateStorageData,
} from './template'

export {
  TEMPLATE_STORAGE_VERSION,
  TEMPLATE_STORAGE_KEYS,
  EXPORT_FILE_EXTENSION,
  EXPORT_FILE_VERSION,
} from './template'
