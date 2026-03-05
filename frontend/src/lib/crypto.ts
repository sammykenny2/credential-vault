/**
 * Client-side E2EE encryption utilities using Web Crypto API.
 *
 * Hybrid encryption scheme:
 * - RSA-OAEP (2048-bit) for wrapping per-credential AES keys
 * - AES-256-GCM for encrypting credential data
 * - Argon2id (via hash-wasm) for deriving key-encryption-key from vault password
 *
 * Flow:
 * 1. User creates vault password -> derive KEK via Argon2id
 * 2. Generate RSA-OAEP key pair
 * 3. Export private key, encrypt with KEK (AES-GCM) -> store on server
 * 4. Export public key -> store on server (plaintext)
 * 5. Encrypt credential: generate random AES key, encrypt data, wrap AES key with RSA public key
 * 6. Decrypt credential: unwrap AES key with RSA private key, decrypt data
 */

import { argon2id } from 'hash-wasm'

// === Constants ===
const AES_ALGORITHM = 'AES-GCM'
const AES_KEY_LENGTH = 256
const IV_LENGTH = 12 // 96 bits for GCM
const SALT_LENGTH = 32 // 32 bytes for Argon2id
const RSA_KEY_SIZE = 2048
const RSA_ALGORITHM = 'RSA-OAEP'
const RSA_HASH = 'SHA-256'

// Argon2id parameters
const ARGON2_MEMORY = 65536 // 64 MB
const ARGON2_ITERATIONS = 3
const ARGON2_PARALLELISM = 1

// KDF version for future migration support (v1 = PBKDF2, v2 = Argon2id)
export const KDF_VERSION = 2

// === Utility Functions ===

function generateIV(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(IV_LENGTH))
}

export function generateSalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(SALT_LENGTH))
}

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)))
}

export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes.buffer
}

// === Key Derivation ===

/**
 * Derive a key-encryption-key (KEK) from the vault password using Argon2id.
 * Used to encrypt/decrypt the RSA private key.
 */
export async function deriveKEK(vaultPassword: string, salt: Uint8Array): Promise<CryptoKey> {
  const hash = await argon2id({
    password: vaultPassword,
    salt,
    parallelism: ARGON2_PARALLELISM,
    iterations: ARGON2_ITERATIONS,
    memorySize: ARGON2_MEMORY,
    hashLength: 32,
    outputType: 'binary',
  })

  return crypto.subtle.importKey(
    'raw',
    hash,
    { name: AES_ALGORITHM, length: AES_KEY_LENGTH },
    false,
    ['encrypt', 'decrypt']
  )
}

// === RSA Key Pair Management ===

/**
 * Generate a new RSA-OAEP key pair for E2EE.
 */
export async function generateKeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(
    {
      name: RSA_ALGORITHM,
      modulusLength: RSA_KEY_SIZE,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: RSA_HASH,
    },
    true, // extractable
    ['encrypt', 'decrypt']  // Note: for RSA-OAEP, encrypt is on public, decrypt on private
  ) as Promise<CryptoKeyPair>
}

/**
 * Export RSA public key to base64 (SPKI format).
 */
export async function exportPublicKey(publicKey: CryptoKey): Promise<string> {
  const exported = await crypto.subtle.exportKey('spki', publicKey)
  return arrayBufferToBase64(exported)
}

/**
 * Import RSA public key from base64 (SPKI format).
 */
export async function importPublicKey(base64Key: string): Promise<CryptoKey> {
  const keyData = base64ToArrayBuffer(base64Key)
  return crypto.subtle.importKey(
    'spki',
    keyData,
    { name: RSA_ALGORITHM, hash: RSA_HASH },
    false,
    ['encrypt']  // Note: wrapKey uses encrypt internally
  )
}

/**
 * Export and encrypt the RSA private key with the KEK.
 * Returns base64(iv + encrypted_pkcs8).
 */
export async function exportEncryptedPrivateKey(
  privateKey: CryptoKey,
  kek: CryptoKey
): Promise<string> {
  // Export private key as PKCS8
  const pkcs8 = await crypto.subtle.exportKey('pkcs8', privateKey)

  // Encrypt with KEK
  const iv = generateIV()
  const encrypted = await crypto.subtle.encrypt(
    { name: AES_ALGORITHM, iv },
    kek,
    pkcs8
  )

  // Combine iv + encrypted
  const combined = new Uint8Array(iv.length + encrypted.byteLength)
  combined.set(iv, 0)
  combined.set(new Uint8Array(encrypted), iv.length)

  return arrayBufferToBase64(combined.buffer)
}

/**
 * Decrypt and import the RSA private key using the KEK.
 */
export async function importEncryptedPrivateKey(
  encryptedBase64: string,
  kek: CryptoKey
): Promise<CryptoKey> {
  const combined = new Uint8Array(base64ToArrayBuffer(encryptedBase64))

  const iv = combined.slice(0, IV_LENGTH)
  const encryptedPkcs8 = combined.slice(IV_LENGTH)

  // Decrypt with KEK
  const pkcs8 = await crypto.subtle.decrypt(
    { name: AES_ALGORITHM, iv },
    kek,
    encryptedPkcs8
  )

  // Import as RSA private key
  return crypto.subtle.importKey(
    'pkcs8',
    pkcs8,
    { name: RSA_ALGORITHM, hash: RSA_HASH },
    false,
    ['decrypt']
  )
}

// === Vault Setup ===

export interface VaultKeys {
  publicKeyBase64: string
  encryptedPrivateKeyBase64: string
  saltBase64: string
  privateKey: CryptoKey
  publicKey: CryptoKey
}

/**
 * Set up a new E2EE vault. Generates keypair and encrypts private key with vault password.
 */
export async function setupVault(vaultPassword: string): Promise<VaultKeys> {
  // Generate salt for Argon2id
  const salt = generateSalt()

  // Derive KEK from vault password
  const kek = await deriveKEK(vaultPassword, salt)

  // Generate RSA key pair
  const keyPair = await generateKeyPair()

  // Export public key
  const publicKeyBase64 = await exportPublicKey(keyPair.publicKey)

  // Export and encrypt private key
  const encryptedPrivateKeyBase64 = await exportEncryptedPrivateKey(keyPair.privateKey, kek)

  return {
    publicKeyBase64,
    encryptedPrivateKeyBase64,
    saltBase64: arrayBufferToBase64(salt.buffer),
    privateKey: keyPair.privateKey,
    publicKey: keyPair.publicKey,
  }
}

/**
 * Unlock an existing vault by decrypting the private key with the vault password.
 */
export async function unlockVault(
  vaultPassword: string,
  saltBase64: string,
  encryptedPrivateKeyBase64: string,
  publicKeyBase64: string
): Promise<{ privateKey: CryptoKey; publicKey: CryptoKey }> {
  const salt = new Uint8Array(base64ToArrayBuffer(saltBase64))
  const kek = await deriveKEK(vaultPassword, salt)
  const privateKey = await importEncryptedPrivateKey(encryptedPrivateKeyBase64, kek)
  const publicKey = await importPublicKey(publicKeyBase64)
  return { privateKey, publicKey }
}

// === Hybrid Credential Encryption ===

/**
 * Credential data structure for encryption.
 * All metadata and secrets are encrypted together.
 */
export interface CredentialData {
  /** Credential name (required) */
  name: string
  /** Optional description */
  description?: string
  /** Optional website URL */
  website_url?: string
  /** Optional category */
  category?: string
  /** Key-value pairs for all credential fields */
  fields: Record<string, string>
  /** Optional notes */
  notes?: string
}

/**
 * Encrypt credential data using hybrid encryption.
 *
 * 1. Generate random AES-256 key
 * 2. Encrypt credential JSON with AES-GCM
 * 3. Wrap AES key with RSA-OAEP public key
 * 4. Return: base64(wrapped_key_len(2 bytes) + wrapped_key + iv + ciphertext)
 */
export async function encryptCredential(
  credential: CredentialData,
  publicKey: CryptoKey
): Promise<string> {
  // Generate random AES key
  const aesKey = await crypto.subtle.generateKey(
    { name: AES_ALGORITHM, length: AES_KEY_LENGTH },
    true, // extractable for wrapping
    ['encrypt']
  )

  // Encrypt credential data with AES
  const iv = generateIV()
  const plaintext = new TextEncoder().encode(JSON.stringify(credential))
  const ciphertext = await crypto.subtle.encrypt(
    { name: AES_ALGORITHM, iv },
    aesKey,
    plaintext
  )

  // Export and wrap AES key with RSA public key
  const rawAesKey = await crypto.subtle.exportKey('raw', aesKey)
  const wrappedKey = await crypto.subtle.encrypt(
    { name: RSA_ALGORITHM },
    publicKey,
    rawAesKey
  )

  // Pack: wrapped_key_length (2 bytes) + wrapped_key + iv + ciphertext
  const wrappedKeyBytes = new Uint8Array(wrappedKey)
  const ciphertextBytes = new Uint8Array(ciphertext)
  const lenBytes = new Uint8Array(2)
  lenBytes[0] = (wrappedKeyBytes.length >> 8) & 0xff
  lenBytes[1] = wrappedKeyBytes.length & 0xff

  const combined = new Uint8Array(
    2 + wrappedKeyBytes.length + IV_LENGTH + ciphertextBytes.length
  )
  combined.set(lenBytes, 0)
  combined.set(wrappedKeyBytes, 2)
  combined.set(iv, 2 + wrappedKeyBytes.length)
  combined.set(ciphertextBytes, 2 + wrappedKeyBytes.length + IV_LENGTH)

  return arrayBufferToBase64(combined.buffer)
}

/**
 * Decrypt credential data using hybrid encryption.
 *
 * 1. Unpack wrapped_key, iv, ciphertext
 * 2. Unwrap AES key with RSA-OAEP private key
 * 3. Decrypt credential JSON with AES-GCM
 */
export async function decryptCredential(
  encryptedData: string,
  privateKey: CryptoKey
): Promise<CredentialData> {
  try {
    const combined = new Uint8Array(base64ToArrayBuffer(encryptedData))

    // Unpack
    const wrappedKeyLen = (combined[0] << 8) | combined[1]
    const wrappedKey = combined.slice(2, 2 + wrappedKeyLen)
    const iv = combined.slice(2 + wrappedKeyLen, 2 + wrappedKeyLen + IV_LENGTH)
    const ciphertext = combined.slice(2 + wrappedKeyLen + IV_LENGTH)

    // Unwrap AES key with RSA private key
    const rawAesKey = await crypto.subtle.decrypt(
      { name: RSA_ALGORITHM },
      privateKey,
      wrappedKey
    )

    // Import AES key
    const aesKey = await crypto.subtle.importKey(
      'raw',
      rawAesKey,
      { name: AES_ALGORITHM, length: AES_KEY_LENGTH },
      false,
      ['decrypt']
    )

    // Decrypt credential data
    const plaintext = await crypto.subtle.decrypt(
      { name: AES_ALGORITHM, iv },
      aesKey,
      ciphertext
    )

    return JSON.parse(new TextDecoder().decode(plaintext)) as CredentialData
  } catch {
    throw new Error('Decryption failed. Wrong vault password or corrupted data.')
  }
}

// === Utility Functions ===

/**
 * Generate a random password.
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
