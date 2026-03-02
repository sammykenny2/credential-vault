/**
 * React hooks for the application.
 */

export { useVaultKey, useVaultKeyStore, useMasterPassword, useMasterPasswordStore } from './useVaultKey'
export { useCredentialCrypto } from './useCredentialCrypto'
export {
  useTemplates,
  useTemplate,
  useTemplateUsageStats,
  useCreateTemplate,
  useUpdateTemplate,
  useDeleteTemplate,
  useRecordTemplateUsage,
  useSyncTemplates,
  useHasBackendTemplates,
  templateKeys,
  extractVersionConflict,
} from './useTemplates'
export { useMigration } from './useMigration'
