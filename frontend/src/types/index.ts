// User types
export type UserRole = 'user' | 'admin'

export interface User {
  id: string
  email: string
  display_name: string
  role: UserRole
  has_vault_keys: boolean
  has_google_linked: boolean
  /** The account can also sign in with email and password (/admin/login). */
  has_password: boolean
  is_active: boolean
  created_at: string
  last_login_at: string | null
}

export interface UserCreate {
  email: string
  display_name: string
  google_id?: string
}

// Auth types
export interface TokenResponse {
  access_token: string
  token_type: string
  /** Access token lifetime in seconds. The refresh token is an HttpOnly cookie. */
  expires_in: number
}

export interface GoogleOAuthCallback {
  code: string
  redirect_uri: string
}

// Credential types (all metadata is inside encrypted_data)
export interface Credential {
  id: string
  encrypted_data: string
  is_active: boolean
  expires_at: string | null
  revoked_at: string | null
  created_at: string
  updated_at: string
}

export interface CredentialListItem {
  id: string
  encrypted_data: string
  is_active: boolean
  expires_at: string | null
  created_at: string
  updated_at: string
}

export interface CredentialCreate {
  /** Client-generated UUID; the ciphertext is bound to it. */
  id?: string
  encrypted_data: string
  expires_at?: string
}

// Password tools types
export interface PasswordStrengthResult {
  score: number
  level: 'very_weak' | 'weak' | 'fair' | 'strong' | 'very_strong'
  feedback: string[]
  details: Record<string, unknown>
  crack_time_display: string
}

export interface BreachCheckResult {
  breached: boolean
  count: number
  error: string | null
}

// Health Dashboard types
export interface CredentialHealthSummary {
  total_credentials: number
  overall_score: number
  strength_distribution: {
    very_strong: number
    strong: number
    fair: number
    weak: number
    very_weak: number
  }
  duplicate_groups: Array<{
    password_hash: string
    credentials: string[]
  }>
  duplicate_count: number
  expiring_soon: Array<{
    id: string
    expires_at: string
    days_left: number
  }>
  expired: Array<{
    id: string
    expired_at: string
  }>
  weak_credentials: Array<{
    id: string
    score: number
    level: string
  }>
  reused_passwords: number
  avg_strength_score: number
  issues: string[]
}

// Vault setup types
export interface VaultSetupRequest {
  public_key: string
  encrypted_private_key: string
  key_salt: string
  kdf_version: number
}

export interface VaultRekeyRequest {
  encrypted_private_key: string
  key_salt: string
  kdf_version: number
}

export interface VaultKeyMaterial {
  public_key: string
  encrypted_private_key: string
  key_salt: string
  kdf_version?: number
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
