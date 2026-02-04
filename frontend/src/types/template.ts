/**
 * Template System Types
 *
 * Defines types for credential templates, including built-in and custom templates,
 * usage tracking, and export/import file formats.
 */

// =============================================================================
// Template Definition Types
// =============================================================================

/**
 * Validation type for template fields.
 * Used to provide basic input validation hints.
 */
export type FieldValidation = 'email' | 'url' | 'port' | 'none'

/**
 * Template field definition.
 * Describes a single field within a credential template.
 */
export interface TemplateField {
  /** Field name displayed as label (e.g., "Username", "API Key") */
  key: string
  /** Placeholder text shown in input field */
  placeholder?: string
  /** Whether to mask input (for passwords, secrets, tokens) */
  isSecret: boolean
  /** Whether this field is required */
  required?: boolean
  /** Default value (usually empty) */
  defaultValue?: string
  /** Basic validation type hint */
  validation?: FieldValidation
}

/**
 * Template category for grouping templates in the UI.
 */
export type TemplateCategory =
  | 'login'
  | 'google'
  | 'development'
  | 'cloud'
  | 'financial'
  | 'network'
  | 'other'

/**
 * Credential template definition.
 * Can be either built-in (shipped with the app) or custom (user-created).
 */
export interface CredentialTemplate {
  /** Unique identifier. Format: 'builtin-{category}-{name}' or 'custom-{uuid}' */
  id: string
  /** Template display name (e.g., "Google Account") */
  name: string
  /** Optional description explaining when to use this template */
  description?: string
  /** Emoji icon for visual identification */
  icon?: string
  /** Category for grouping in UI */
  category?: TemplateCategory
  /** Array of field definitions */
  fields: TemplateField[]
  /** Whether this is a built-in template (cannot be edited/deleted) */
  isBuiltIn: boolean
  /** ISO timestamp when template was created (for custom templates) */
  createdAt?: string
  /** ISO timestamp when template was last updated (for custom templates) */
  updatedAt?: string
}

// =============================================================================
// Usage Tracking Types
// =============================================================================

/**
 * Records when a template was used to create a credential.
 * Used for sorting templates (recently/frequently used).
 */
export interface TemplateUsage {
  /** Template ID that was used */
  templateId: string
  /** ISO timestamp when template was used */
  usedAt: string
  /** ID of the credential created from this template (optional) */
  credentialId?: string
}

/**
 * Aggregated usage statistics for a template.
 */
export interface TemplateUsageStats {
  /** Template ID */
  templateId: string
  /** Total number of times used */
  useCount: number
  /** ISO timestamp of last use */
  lastUsedAt: string | null
}

// =============================================================================
// Export/Import Types
// =============================================================================

/**
 * Exported file structure (.cvault format).
 * Contains encrypted template data with metadata.
 */
export interface ExportFile {
  /** File format version for compatibility checking */
  version: number
  /** ISO timestamp when export was created */
  exportedAt: string
  /** Base64 encoded AES-256-GCM encrypted data */
  encryptedData: string
  /** Base64 encoded PBKDF2 salt */
  salt: string
  /** Base64 encoded AES IV (initialization vector) */
  iv: string
}

/**
 * Decrypted content of an export file.
 */
export interface ExportedData {
  /** Custom templates to export */
  customTemplates: CredentialTemplate[]
  /** Template usage history */
  templateUsage: TemplateUsage[]
}

/**
 * Options for handling import conflicts when template names collide.
 */
export type ImportConflictStrategy = 'skip' | 'replace' | 'keep-both'

/**
 * Result of an import operation.
 */
export interface ImportResult {
  /** Whether import was successful */
  success: boolean
  /** Number of templates imported */
  imported: number
  /** Number of templates skipped due to conflicts */
  skipped: number
  /** Number of templates replaced */
  replaced: number
  /** Error message if import failed */
  error?: string
}

// =============================================================================
// Storage Types
// =============================================================================

/**
 * Shape of template data stored in localStorage.
 */
export interface TemplateStorageData {
  /** User's custom templates */
  customTemplates: CredentialTemplate[]
  /** Template usage history */
  usage: TemplateUsage[]
  /** Storage version for migration */
  version: number
}

/**
 * Current storage version.
 * Increment when making breaking changes to storage format.
 */
export const TEMPLATE_STORAGE_VERSION = 1

/**
 * localStorage keys used by template system.
 */
export const TEMPLATE_STORAGE_KEYS = {
  DATA: 'credential-vault-templates',
} as const

/**
 * File extension for exported template files.
 */
export const EXPORT_FILE_EXTENSION = '.cvault'

/**
 * Current export file format version.
 */
export const EXPORT_FILE_VERSION = 1
