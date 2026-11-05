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
  generatePassword,
  assertCredentialData,
} from './crypto'
import type { CredentialData } from './crypto'
import { MIN_BACKUP_PASSWORD_LENGTH } from './passwordPolicy'

// === Types ===

export interface CredentialBackupEntry {
  data: CredentialData
  expires_at: string | null
  created_at: string
  is_active?: boolean
  revoked_at?: string | null
  source_origin?: 'authored' | 'legacy-unverified'
}

export interface CredentialBackupPayload {
  credentials: CredentialBackupEntry[]
}

export interface CredentialBackupFile {
  type: 'credential-backup' | 'credential-record-backup'
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
export const MAX_BACKUP_FILE_BYTES = 32 * 1024 * 1024
const MAX_BACKUP_RECORDS = 10_000
const RECORD_BACKUP_AAD = new TextEncoder().encode('credential-vault/record-backup/1')

// === Core Functions ===

function generateIV(): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(IV_LENGTH))
}

/** 32 uniformly sampled alphanumeric characters provide over 128 bits of entropy. */
export function generateBackupPassword(): string {
  return generatePassword(32, { uppercase: true, lowercase: true, numbers: true, symbols: false })
}

/**
 * Encrypt credentials into a backup file.
 */
export async function encryptBackup(
  credentials: CredentialBackupEntry[],
  password: string
): Promise<CredentialBackupFile> {
  if (password.length < MIN_BACKUP_PASSWORD_LENGTH) {
    throw new Error(`Backup password must be at least ${MIN_BACKUP_PASSWORD_LENGTH} characters.`)
  }
  validatePayload({ credentials }, true)
  const salt = generateSalt()
  const iv = generateIV()
  const key = await deriveKEK(password, salt)

  const payload: CredentialBackupPayload = { credentials }
  const plaintext = new TextEncoder().encode(JSON.stringify(payload))

  const ciphertext = await crypto.subtle.encrypt(
    { name: AES_ALGORITHM, iv, additionalData: RECORD_BACKUP_AAD },
    key,
    plaintext
  )

  return {
    type: 'credential-record-backup',
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
      file.type === 'credential-record-backup'
        ? { name: AES_ALGORITHM, iv, additionalData: RECORD_BACKUP_AAD }
        : { name: AES_ALGORITHM, iv },
      key,
      ciphertext
    )

    try {
      const payload: unknown = JSON.parse(new TextDecoder().decode(plaintext))
      validatePayload(payload, file.type === 'credential-record-backup')
      if (payload.credentials.length !== file.credentialCount) throw new Error('Count mismatch')
      return payload
    } finally {
      new Uint8Array(plaintext).fill(0)
    }
  } catch {
    throw new Error('Decryption failed. Wrong password or corrupted file.')
  }
}

/**
 * Read and validate a .cvault backup file from a File object.
 */
export async function readBackupFile(file: File): Promise<CredentialBackupFile> {
  if (file.size > MAX_BACKUP_FILE_BYTES) throw new Error('Backup exceeds the 32 MiB file limit.')
  const text = await file.text()

  try {
    const parsed = JSON.parse(text)

    // Reject template .cvault files
    if (parsed.type && parsed.type !== 'credential-backup' && parsed.type !== 'credential-record-backup') {
      throw new Error('This is not a credential backup file.')
    }

    // Must have the credential-backup type marker
    if (parsed.type !== 'credential-backup' && parsed.type !== 'credential-record-backup') {
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

    if (parsed.version !== 1) {
      throw new Error(
        `Backup version ${parsed.version} is not supported. Please update the application.`
      )
    }
    if (!Number.isInteger(parsed.credentialCount) || parsed.credentialCount < 0 ||
        parsed.credentialCount > MAX_BACKUP_RECORDS ||
        base64ToArrayBuffer(parsed.iv).byteLength !== IV_LENGTH ||
        base64ToArrayBuffer(parsed.salt).byteLength !== 32) {
      throw new Error('Invalid credential backup parameters.')
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
  if (blob.size > MAX_BACKUP_FILE_BYTES) throw new Error('Backup exceeds the 32 MiB file limit.')
  const url = URL.createObjectURL(blob)

  const a = document.createElement('a')
  a.href = url
  a.download = `credentials-backup-${new Date().toISOString().split('T')[0]}.cvault`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)

  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function validatePayload(value: unknown, requireStatus: boolean): asserts value is CredentialBackupPayload {
  if (!value || typeof value !== 'object' || !('credentials' in value) ||
      !Array.isArray(value.credentials) || value.credentials.length > MAX_BACKUP_RECORDS) {
    throw new Error('Invalid backup payload')
  }
  for (const entry of value.credentials) {
    if (!entry || typeof entry !== 'object') throw new Error('Invalid backup entry')
    assertCredentialData(entry.data)
    const validDate = (v: unknown) => typeof v === 'string' && Number.isFinite(Date.parse(v))
    if (!validDate(entry.created_at) || (entry.expires_at !== null && !validDate(entry.expires_at))) {
      throw new Error('Invalid backup dates')
    }
    if (requireStatus && (typeof entry.is_active !== 'boolean' ||
        (entry.revoked_at !== null && !validDate(entry.revoked_at)) ||
        (entry.is_active && entry.revoked_at !== null) ||
        (!entry.is_active && entry.revoked_at === null) ||
        !['authored', 'legacy-unverified'].includes(entry.source_origin))) {
      throw new Error('Invalid backup status')
    }
  }
}
