/**
 * React hooks for the application.
 */

export { useMasterPassword, useMasterPasswordStore } from './useMasterPassword'
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
