/**
 * Template Export/Import Encryption
 *
 * Handles encryption and decryption of template export files (.cvault).
 * Uses AES-256-GCM with PBKDF2 key derivation.
 */

import type {
  CredentialTemplate,
  TemplateUsage,
  ExportFile,
  ExportedData,
  ImportResult,
  ImportConflictStrategy,
} from '@/types/template'
import { EXPORT_FILE_VERSION } from '@/types/template'
import {
  getCustomTemplates,
  getAllUsageRecords,
  importTemplateData,
} from './templateStorage'

// =============================================================================
// Constants
// =============================================================================

const ALGORITHM = 'AES-GCM'
const KEY_LENGTH = 256
const IV_LENGTH = 12 // 96 bits for GCM
const SALT_LENGTH = 16
const PBKDF2_ITERATIONS = 100000

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Generate a random salt for key derivation.
 */
function generateSalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(SALT_LENGTH))
}

/**
 * Generate a random IV for encryption.
 */
function generateIV(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(IV_LENGTH))
}

/**
 * Convert Uint8Array to base64 string.
 */
function uint8ArrayToBase64(array: Uint8Array): string {
  return btoa(String.fromCharCode(...array))
}

/**
 * Convert base64 string to Uint8Array.
 */
function base64ToUint8Array(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), c => c.charCodeAt(0))
}

/**
 * Derive an encryption key from password using PBKDF2.
 */
async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const passwordKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  )

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    passwordKey,
    { name: ALGORITHM, length: KEY_LENGTH },
    false,
    ['encrypt', 'decrypt']
  )
}

// =============================================================================
// Export Functions
// =============================================================================

/**
 * Encrypt data for export.
 *
 * @param data - Data to encrypt
 * @param password - Export password
 * @returns ExportFile object ready to be saved
 */
async function encryptForExport(data: ExportedData, password: string): Promise<ExportFile> {
  const salt = generateSalt()
  const iv = generateIV()
  const key = await deriveKey(password, salt)

  const plaintext = new TextEncoder().encode(JSON.stringify(data))

  const ciphertext = await crypto.subtle.encrypt(
    { name: ALGORITHM, iv },
    key,
    plaintext
  )

  return {
    version: EXPORT_FILE_VERSION,
    exportedAt: new Date().toISOString(),
    encryptedData: uint8ArrayToBase64(new Uint8Array(ciphertext)),
    salt: uint8ArrayToBase64(salt),
    iv: uint8ArrayToBase64(iv),
  }
}

/**
 * Decrypt an export file.
 *
 * @param file - ExportFile object to decrypt
 * @param password - Export password
 * @returns Decrypted data
 * @throws Error if decryption fails
 */
async function decryptExport(file: ExportFile, password: string): Promise<ExportedData> {
  try {
    const salt = base64ToUint8Array(file.salt)
    const iv = base64ToUint8Array(file.iv)
    const ciphertext = base64ToUint8Array(file.encryptedData)

    const key = await deriveKey(password, salt)

    const plaintext = await crypto.subtle.decrypt(
      { name: ALGORITHM, iv },
      key,
      ciphertext
    )

    const decoded = new TextDecoder().decode(plaintext)
    return JSON.parse(decoded) as ExportedData
  } catch (error) {
    throw new Error('Decryption failed. Invalid password or corrupted file.')
  }
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Export custom templates to an encrypted file.
 *
 * @param password - Password to encrypt the export
 * @returns ExportFile object ready to be downloaded
 */
export async function exportTemplates(password: string): Promise<ExportFile> {
  const customTemplates = getCustomTemplates()
  const usage = getAllUsageRecords()

  const data: ExportedData = {
    customTemplates,
    templateUsage: usage,
  }

  return encryptForExport(data, password)
}

/**
 * Create a downloadable file from export data.
 *
 * @param exportFile - ExportFile object
 * @param filename - Desired filename (without extension)
 * @returns Blob URL for download
 */
export function createDownloadUrl(exportFile: ExportFile, filename: string = 'templates'): {
  url: string
  filename: string
} {
  const json = JSON.stringify(exportFile, null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)

  return {
    url,
    filename: `${filename}.cvault`,
  }
}

/**
 * Trigger download of an export file.
 *
 * @param exportFile - ExportFile object to download
 * @param filename - Desired filename (without extension)
 */
export function downloadExportFile(exportFile: ExportFile, filename: string = 'templates'): void {
  const { url, filename: fullFilename } = createDownloadUrl(exportFile, filename)

  const a = document.createElement('a')
  a.href = url
  a.download = fullFilename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)

  // Clean up blob URL
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/**
 * Read and parse an uploaded export file.
 *
 * @param file - File object from file input
 * @returns Parsed ExportFile
 * @throws Error if file is invalid
 */
export async function readExportFile(file: File): Promise<ExportFile> {
  const text = await file.text()

  try {
    const parsed = JSON.parse(text) as ExportFile

    // Validate structure
    if (
      typeof parsed.version !== 'number' ||
      typeof parsed.exportedAt !== 'string' ||
      typeof parsed.encryptedData !== 'string' ||
      typeof parsed.salt !== 'string' ||
      typeof parsed.iv !== 'string'
    ) {
      throw new Error('Invalid file structure')
    }

    // Check version compatibility
    if (parsed.version > EXPORT_FILE_VERSION) {
      throw new Error(
        `File version ${parsed.version} is not supported. Please update the application.`
      )
    }

    return parsed
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error('Invalid file format. Expected a .cvault file.')
    }
    throw error
  }
}

/**
 * Import templates from an encrypted export file.
 *
 * @param file - File object from file input
 * @param password - Password to decrypt the export
 * @param conflictStrategy - How to handle name conflicts
 * @returns Import result with statistics
 */
export async function importTemplates(
  file: File,
  password: string,
  conflictStrategy: ImportConflictStrategy = 'skip'
): Promise<ImportResult> {
  try {
    // Read and parse file
    const exportFile = await readExportFile(file)

    // Decrypt
    const data = await decryptExport(exportFile, password)

    // Validate data structure
    if (!Array.isArray(data.customTemplates)) {
      throw new Error('Invalid export data: missing templates array')
    }

    // Import into storage
    const result = importTemplateData(
      data.customTemplates,
      data.templateUsage || [],
      conflictStrategy
    )

    return {
      success: true,
      ...result,
    }
  } catch (error) {
    return {
      success: false,
      imported: 0,
      skipped: 0,
      replaced: 0,
      error: error instanceof Error ? error.message : 'Import failed',
    }
  }
}

/**
 * Try to decrypt an export file with a given password.
 * Useful for validation before actual import.
 *
 * @param file - ExportFile object
 * @param password - Password to test
 * @returns true if password is correct
 */
export async function verifyExportPassword(file: ExportFile, password: string): Promise<boolean> {
  try {
    await decryptExport(file, password)
    return true
  } catch {
    return false
  }
}

/**
 * Get metadata from an export file without decrypting.
 * Useful for displaying info before import.
 */
export function getExportMetadata(file: ExportFile): {
  version: number
  exportedAt: Date
  isCompatible: boolean
} {
  return {
    version: file.version,
    exportedAt: new Date(file.exportedAt),
    isCompatible: file.version <= EXPORT_FILE_VERSION,
  }
}
