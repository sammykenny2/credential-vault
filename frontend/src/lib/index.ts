/**
 * Utility libraries.
 */

export {
  encryptCredential,
  decryptCredential,
  generatePassword,
  sha256,
  deriveKEK,
  generateSalt,
  setupVault,
  unlockVault,
  KDF_VERSION,
  type CredentialData,
} from './crypto'

// Template Storage
export {
  loadTemplateData,
  saveTemplateData,
  getCustomTemplates,
  getCustomTemplate,
  getTemplate,
  getAllTemplates,
  createCustomTemplate,
  updateCustomTemplate,
  deleteCustomTemplate,
  recordTemplateUsage,
  getTemplateUsageStats,
  getAllUsageStats,
  getTemplatesSortedByUsage,
  checkStorageCapacity,
  clearAllTemplateData,
  // Migration utilities (Phase 3)
  hasLocalTemplates,
  isMigrationCompleted,
  markMigrationCompleted,
  prepareSyncRequest,
  clearLocalTemplatesAfterMigration,
  needsMigration,
} from './templateStorage'

// Template Export/Import
export {
  exportTemplates,
  createDownloadUrl,
  downloadExportFile,
  readExportFile,
  importTemplates,
  verifyExportPassword,
  getExportMetadata,
} from './templateExport'
