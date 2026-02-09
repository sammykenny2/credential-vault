/**
 * Client-side encryption utilities using Web Crypto API.
 *
 * Credentials are encrypted in the browser before being sent to the server.
 * The server never sees plaintext credential data.
 *
 * Encryption: AES-256-GCM with random IV
 * Key Derivation: PBKDF2 with SHA-256
 */

// Constants
const ALGORITHM = 'AES-GCM'
const KEY_LENGTH = 256
const IV_LENGTH = 12 // 96 bits for GCM
const SALT_LENGTH = 16
const PBKDF2_ITERATIONS = 100000

/**
 * Generate a random salt for key derivation.
 */
export function generateSalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(SALT_LENGTH))
}

/**
 * Generate a random IV for encryption.
 */
function generateIV(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(IV_LENGTH))
}

/**
 * Derive an encryption key from a master password using PBKDF2.
 *
 * @param password - User's master password
 * @param salt - Salt for key derivation (should be stored with encrypted data)
 * @returns CryptoKey for AES-GCM encryption
 */
export async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  // Import password as raw key material
  const passwordKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  )

  // Derive AES key using PBKDF2
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

/**
 * Encrypt data using AES-256-GCM.
 *
 * Output format: base64(salt + iv + ciphertext)
 *
 * @param data - Data object to encrypt
 * @param password - Master password for key derivation
 * @returns Base64 encoded encrypted string
 */
export async function encryptData(data: Record<string, unknown>, password: string): Promise<string> {
  // Generate salt and IV
  const salt = generateSalt()
  const iv = generateIV()

  // Derive key from password
  const key = await deriveKey(password, salt)

  // Encode data as JSON
  const plaintext = new TextEncoder().encode(JSON.stringify(data))

  // Encrypt
  const ciphertext = await crypto.subtle.encrypt(
    { name: ALGORITHM, iv },
    key,
    plaintext
  )

  // Combine salt + iv + ciphertext
  const combined = new Uint8Array(salt.length + iv.length + ciphertext.byteLength)
  combined.set(salt, 0)
  combined.set(iv, salt.length)
  combined.set(new Uint8Array(ciphertext), salt.length + iv.length)

  // Encode as base64
  return btoa(String.fromCharCode(...combined))
}

/**
 * Decrypt data using AES-256-GCM.
 *
 * @param encryptedData - Base64 encoded encrypted string
 * @param password - Master password for key derivation
 * @returns Decrypted data object
 * @throws Error if decryption fails (wrong password, tampered data, etc.)
 */
export async function decryptData<T = Record<string, unknown>>(
  encryptedData: string,
  password: string
): Promise<T> {
  try {
    // Decode from base64
    const combined = Uint8Array.from(atob(encryptedData), c => c.charCodeAt(0))

    // Extract salt, iv, and ciphertext
    const salt = combined.slice(0, SALT_LENGTH)
    const iv = combined.slice(SALT_LENGTH, SALT_LENGTH + IV_LENGTH)
    const ciphertext = combined.slice(SALT_LENGTH + IV_LENGTH)

    // Derive key from password
    const key = await deriveKey(password, salt)

    // Decrypt
    const plaintext = await crypto.subtle.decrypt(
      { name: ALGORITHM, iv },
      key,
      ciphertext
    )

    // Parse JSON
    const decoded = new TextDecoder().decode(plaintext)
    return JSON.parse(decoded) as T
  } catch {
    throw new Error('Decryption failed. Invalid password or corrupted data.')
  }
}

/**
 * Credential data structure for encryption.
 * Pure key-value storage - all fields are dynamic.
 */
export interface CredentialData {
  /** Key-value pairs for all credential fields */
  fields: Record<string, string>
  /** Optional notes */
  notes?: string
}

/**
 * Encrypt credential data.
 *
 * @param credential - Credential data to encrypt
 * @param masterPassword - User's master password
 * @returns Base64 encoded encrypted string
 */
export async function encryptCredential(
  credential: CredentialData,
  masterPassword: string
): Promise<string> {
  return encryptData(credential, masterPassword)
}

/**
 * Decrypt credential data.
 *
 * @param encryptedData - Base64 encoded encrypted string
 * @param masterPassword - User's master password
 * @returns Decrypted credential data
 */
export async function decryptCredential(
  encryptedData: string,
  masterPassword: string
): Promise<CredentialData> {
  return decryptData<CredentialData>(encryptedData, masterPassword)
}

/**
 * Verify if a password can decrypt the given data.
 * Useful for validating master password.
 *
 * @param encryptedData - Base64 encoded encrypted string
 * @param password - Password to test
 * @returns true if password is correct
 */
export async function verifyPassword(encryptedData: string, password: string): Promise<boolean> {
  try {
    await decryptData(encryptedData, password)
    return true
  } catch {
    return false
  }
}

/**
 * Generate a random password.
 *
 * @param length - Password length (default: 16)
 * @param options - Character set options
 * @returns Random password string
 */
export function generatePassword(
  length: number = 16,
  options: {
    uppercase?: boolean
    lowercase?: boolean
    numbers?: boolean
    symbols?: boolean
  } = {}
): string {
  const {
    uppercase = true,
    lowercase = true,
    numbers = true,
    symbols = true,
  } = options

  let charset = ''
  if (uppercase) charset += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  if (lowercase) charset += 'abcdefghijklmnopqrstuvwxyz'
  if (numbers) charset += '0123456789'
  if (symbols) charset += '!@#$%^&*()_+-=[]{}|;:,.<>?'

  if (!charset) charset = 'abcdefghijklmnopqrstuvwxyz'

  const randomValues = crypto.getRandomValues(new Uint8Array(length))
  return Array.from(randomValues)
    .map(v => charset[v % charset.length])
    .join('')
}

/**
 * Hash data using SHA-256.
 * Useful for creating fingerprints or checksums.
 *
 * @param data - String to hash
 * @returns Hex encoded hash
 */
export async function sha256(data: string): Promise<string> {
  const buffer = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(data)
  )
  return Array.from(new Uint8Array(buffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}
