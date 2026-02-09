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
  expires_at: string | null
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
  expires_at: string | null
  created_at: string
  updated_at: string
}

export interface CredentialCreate {
  name: string
  description?: string
  website_url?: string
  category?: string
  encrypted_data: string
  expires_at?: string
}

export interface CredentialData {
  username?: string
  password?: string
  notes?: string
  custom_fields?: Record<string, string>
}

// Password tools types
export interface PasswordGenerateRequest {
  length: number
  uppercase: boolean
  lowercase: boolean
  digits: boolean
  symbols: boolean
  exclude_ambiguous: boolean
}

export interface PasswordGenerateResponse {
  password: string
  length: number
  strength: PasswordStrengthResult
}

export interface PassphraseGenerateRequest {
  word_count: number
  separator: string
  capitalize: boolean
  include_number: boolean
}

export interface PassphraseGenerateResponse {
  passphrase: string
  word_count: number
  strength: PasswordStrengthResult
}

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
    name: string
    expires_at: string
    days_left: number
  }>
  expired: Array<{
    id: string
    name: string
    expired_at: string
  }>
  weak_credentials: Array<{
    id: string
    name: string
    score: number
    level: string
  }>
  reused_passwords: number
  avg_strength_score: number
  issues: string[]
}

// Sharing types
export interface ShareCreate {
  credential_id: string
  shared_with_email: string
  encrypted_data: string
  permission: 'read_only' | 'read_write'
}

export interface SharedByMe {
  id: string
  credential_id: string
  credential_name: string
  shared_with_email: string
  shared_with_name: string
  permission: string
  created_at: string
}

export interface SharedWithMe {
  id: string
  credential_id: string
  credential_name: string
  description: string | null
  category: string | null
  encrypted_data: string
  permission: string
  shared_by_email: string
  shared_by_name: string
  shared_at: string
}

// Emergency access types
export interface EmergencyAccessGrant {
  id: string
  grantee_email?: string
  grantee_name?: string
  grantor_email?: string
  grantor_name?: string
  status: string
  wait_time_days: number
  recovery_initiated_at: string | null
  recovery_deadline: string | null
  created_at: string
}

// TOTP types
export interface TOTPAccount {
  id: string
  user_id: string
  issuer: string
  account_name: string
  algorithm: string
  digits: number
  period: number
  credential_id: string | null
  icon: string | null
  created_at: string
  updated_at: string
}

export interface TOTPAccountCreate {
  encrypted_secret: string
  issuer: string
  account_name: string
  algorithm?: string
  digits?: number
  period?: number
  credential_id?: string
  icon?: string
}

export interface TOTPCodeResponse {
  code: string
  remaining_seconds: number
  period: number
}

// WebAuthn types
export interface WebAuthnCredentialInfo {
  id: string
  device_name: string
  credential_type: string
  is_active: boolean
  created_at: string
  last_used_at: string | null
}

// Backup types
export interface BackupMetadata {
  version: string
  created_at: string
  app_version: string
  credential_count: number
  template_count: number
  totp_account_count: number
}

export interface BackupResponse {
  metadata: BackupMetadata
  encrypted_data: string
}

export interface RestoreResult {
  credentials_restored: number
  templates_restored: number
  totp_accounts_restored: number
  errors: string[]
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
