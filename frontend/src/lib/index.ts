/**
 * Utility libraries.
 */

export {
  encryptData,
  decryptData,
  encryptCredential,
  decryptCredential,
  generatePassword,
  verifyPassword,
  sha256,
  deriveKey,
  generateSalt,
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
