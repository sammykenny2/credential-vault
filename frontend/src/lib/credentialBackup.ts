/**
 * Credential Backup/Restore (Encrypted Export/Import)
 *
 * Encrypts all credentials into a .cvault file using Argon2id + AES-256-GCM.
 * All crypto happens client-side — the server never sees plaintext.
 */

import {
  deriveKEK,
  generateSalt,
  arrayBufferToBase64,
  base64ToArrayBuffer,
} from './crypto'
import type { CredentialData } from './crypto'

// === Types ===

export interface CredentialBackupEntry {
  data: CredentialData
  expires_at: string | null
  created_at: string
}

export interface CredentialBackupPayload {
  credentials: CredentialBackupEntry[]
}

export interface CredentialBackupFile {
  type: 'credential-backup'
  version: 1
  exportedAt: string
  credentialCount: number
  salt: string
  iv: string
  encryptedData: string
}

// === Constants ===

const AES_ALGORITHM = 'AES-GCM'
const IV_LENGTH = 12

// === Core Functions ===

function generateIV(): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(IV_LENGTH))
}

/**
 * Encrypt credentials into a backup file.
 */
export async function encryptBackup(
  credentials: CredentialBackupEntry[],
  password: string
): Promise<CredentialBackupFile> {
  const salt = generateSalt()
  const iv = generateIV()
  const key = await deriveKEK(password, salt)

  const payload: CredentialBackupPayload = { credentials }
  const plaintext = new TextEncoder().encode(JSON.stringify(payload))

  const ciphertext = await crypto.subtle.encrypt(
    { name: AES_ALGORITHM, iv },
    key,
    plaintext
  )

  return {
    type: 'credential-backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    credentialCount: credentials.length,
    salt: arrayBufferToBase64(salt),
    iv: arrayBufferToBase64(iv),
    encryptedData: arrayBufferToBase64(ciphertext),
  }
}

/**
 * Decrypt a backup file and return the credential payload.
 */
export async function decryptBackup(
  file: CredentialBackupFile,
  password: string
): Promise<CredentialBackupPayload> {
  try {
    const salt = new Uint8Array(base64ToArrayBuffer(file.salt))
    const iv = new Uint8Array(base64ToArrayBuffer(file.iv))
    const ciphertext = base64ToArrayBuffer(file.encryptedData)

    const key = await deriveKEK(password, salt)

    const plaintext = await crypto.subtle.decrypt(
      { name: AES_ALGORITHM, iv },
      key,
      ciphertext
    )

    return JSON.parse(new TextDecoder().decode(plaintext)) as CredentialBackupPayload
  } catch {
    throw new Error('Decryption failed. Wrong password or corrupted file.')
  }
}

/**
 * Read and validate a .cvault backup file from a File object.
 */
export async function readBackupFile(file: File): Promise<CredentialBackupFile> {
  const text = await file.text()

  try {
    const parsed = JSON.parse(text)

    // Reject template .cvault files
    if (parsed.type && parsed.type !== 'credential-backup') {
      throw new Error('This is not a credential backup file.')
    }

    // Must have the credential-backup type marker
    if (parsed.type !== 'credential-backup') {
      // Legacy check: if it has version but no type, it's a template export
      if (parsed.version && !parsed.type) {
        throw new Error(
          'This appears to be a template export file, not a credential backup. ' +
          'Use the Templates page to import template files.'
        )
      }
      throw new Error('Invalid file format. Expected a credential backup (.cvault) file.')
    }

    // Validate structure
    if (
      typeof parsed.version !== 'number' ||
      typeof parsed.exportedAt !== 'string' ||
      typeof parsed.encryptedData !== 'string' ||
      typeof parsed.salt !== 'string' ||
      typeof parsed.iv !== 'string' ||
      typeof parsed.credentialCount !== 'number'
    ) {
      throw new Error('Invalid credential backup file structure.')
    }

    if (parsed.version > 1) {
      throw new Error(
        `Backup version ${parsed.version} is not supported. Please update the application.`
      )
    }

    return parsed as CredentialBackupFile
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error('Invalid file format. Expected a .cvault file.', { cause: error })
    }
    throw error
  }
}

/**
 * Trigger a browser download of the backup file.
 */
export function downloadBackupFile(backupFile: CredentialBackupFile): void {
  const json = JSON.stringify(backupFile, null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)

  const a = document.createElement('a')
  a.href = url
  a.download = `credentials-backup-${new Date().toISOString().split('T')[0]}.cvault`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)

  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
