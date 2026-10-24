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
 *
 * Credential blob formats (base64 of the bytes below):
 * - v1 (legacy, read-only): wrapped_key_len(2) | wrapped_key | iv(12) | ciphertext
 * - v2 (current):           0xFF 0x02 | wrapped_key_len(2) | wrapped_key | iv(12) | ciphertext
 *   with the credential id as AES-GCM additional data, so a blob moved to a
 *   different credential row on the server fails authentication.
 */

import { argon2id } from 'hash-wasm'
import { randomInt } from './passwordTools'

// === Constants ===
const AES_ALGORITHM = 'AES-GCM'
const AES_KEY_LENGTH = 256
const IV_LENGTH = 12 // 96 bits for GCM
const SALT_LENGTH = 32 // 32 bytes for Argon2id
const RSA_KEY_SIZE = 2048
const RSA_ALGORITHM = 'RSA-OAEP'
const RSA_HASH = 'SHA-256'

/** Current blob format: magic byte + version byte prefix. */
const BLOB_MAGIC = 0xff
const BLOB_VERSION_2 = 0x02

// === Key derivation versions ===

export interface Argon2Params {
  memorySize: number
  iterations: number
  parallelism: number
}

/**
 * KDF parameter sets by version. The version is stored with the vault keys so
 * parameters can be raised later without breaking existing vaults.
 * (v1 was PBKDF2 in a pre-release build and is no longer supported.)
 */
const KDF_PARAMS: Record<number, Argon2Params> = {
  2: { memorySize: 65536, iterations: 3, parallelism: 1 }, // 64 MB, 3 passes
}

/** Version used for new vaults and re-wrapped keys. */
export const KDF_VERSION = 2

export function kdfParamsFor(version: number): Argon2Params {
  const params = KDF_PARAMS[version]
  if (!params) {
    throw new Error(`Unsupported vault key derivation version: ${version}`)
  }
  return params
}

// === Utility Functions ===

// Web Crypto wants views over a plain ArrayBuffer (BufferSource), so the
// helpers below are typed as Uint8Array<ArrayBuffer> rather than ArrayBufferLike.
type Bytes = Uint8Array<ArrayBuffer>

function generateIV(): Bytes {
  return crypto.getRandomValues(new Uint8Array(IV_LENGTH))
}

export function generateSalt(): Bytes {
  return crypto.getRandomValues(new Uint8Array(SALT_LENGTH))
}

/** Copy any byte view into a fresh Uint8Array backed by a plain ArrayBuffer. */
function toBytes(view: ArrayBufferView | ArrayBufferLike): Bytes {
  const source = ArrayBuffer.isView(view)
    ? new Uint8Array(view.buffer, view.byteOffset, view.byteLength)
    : new Uint8Array(view)
  const copy = new Uint8Array(source.byteLength)
  copy.set(source)
  return copy
}

const BASE64_CHUNK = 0x8000

/**
 * Base64-encode bytes in chunks. Spreading a whole buffer into
 * String.fromCharCode overflows the argument list for large blobs.
 */
export function arrayBufferToBase64(buffer: ArrayBufferLike | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i += BASE64_CHUNK) {
    const chunk = bytes.subarray(i, i + BASE64_CHUNK)
    binary += String.fromCharCode.apply(null, chunk as unknown as number[])
  }
  return btoa(binary)
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
export async function deriveKEK(
  vaultPassword: string,
  salt: Uint8Array,
  kdfVersion: number = KDF_VERSION
): Promise<CryptoKey> {
  const params = kdfParamsFor(kdfVersion)
  const hash = await argon2id({
    password: vaultPassword,
    salt,
    parallelism: params.parallelism,
    iterations: params.iterations,
    memorySize: params.memorySize,
    hashLength: 32,
    outputType: 'binary',
  })

  return crypto.subtle.importKey(
    'raw',
    toBytes(hash),
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
    true, // extractable — public key, safe to export for verification
    ['encrypt']  // Note: wrapKey uses encrypt internally
  )
}

function importPrivateKeyNonExtractable(pkcs8: ArrayBuffer): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'pkcs8',
    pkcs8,
    { name: RSA_ALGORITHM, hash: RSA_HASH },
    false,
    ['decrypt']
  )
}

/** AES-GCM wrap of PKCS8 bytes with the KEK: base64(iv + ciphertext). */
async function wrapPkcs8(pkcs8: ArrayBuffer, kek: CryptoKey): Promise<string> {
  const iv = generateIV()
  const encrypted = await crypto.subtle.encrypt({ name: AES_ALGORITHM, iv }, kek, pkcs8)

  const combined = new Uint8Array(iv.length + encrypted.byteLength)
  combined.set(iv, 0)
  combined.set(new Uint8Array(encrypted), iv.length)
  return arrayBufferToBase64(combined)
}

/** Inverse of wrapPkcs8. Throws when the KEK is wrong (GCM tag mismatch). */
async function unwrapPkcs8(encryptedBase64: string, kek: CryptoKey): Promise<ArrayBuffer> {
  const combined = new Uint8Array(base64ToArrayBuffer(encryptedBase64))
  const iv = combined.slice(0, IV_LENGTH)
  const encryptedPkcs8 = combined.slice(IV_LENGTH)
  return crypto.subtle.decrypt({ name: AES_ALGORITHM, iv }, kek, encryptedPkcs8)
}

/**
 * Export and encrypt the RSA private key with the KEK.
 * Returns base64(iv + encrypted_pkcs8).
 */
export async function exportEncryptedPrivateKey(
  privateKey: CryptoKey,
  kek: CryptoKey
): Promise<string> {
  const pkcs8 = await crypto.subtle.exportKey('pkcs8', privateKey)
  return wrapPkcs8(pkcs8, kek)
}

/**
 * Decrypt and import the RSA private key using the KEK.
 * The imported key is not extractable.
 */
export async function importEncryptedPrivateKey(
  encryptedBase64: string,
  kek: CryptoKey
): Promise<CryptoKey> {
  const pkcs8 = await unwrapPkcs8(encryptedBase64, kek)
  return importPrivateKeyNonExtractable(pkcs8)
}

// === Vault Setup ===

export interface VaultKeys {
  publicKeyBase64: string
  encryptedPrivateKeyBase64: string
  saltBase64: string
  kdfVersion: number
  /** Non-extractable; safe to keep in memory for the session. */
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
  const kek = await deriveKEK(vaultPassword, salt, KDF_VERSION)

  // Generate RSA key pair (extractable only so it can be exported once)
  const keyPair = await generateKeyPair()

  // Export public key
  const publicKeyBase64 = await exportPublicKey(keyPair.publicKey)

  // Export the private key once: wrap it for the server and re-import it
  // non-extractable for the in-memory session copy.
  const pkcs8 = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey)
  const encryptedPrivateKeyBase64 = await wrapPkcs8(pkcs8, kek)
  const privateKey = await importPrivateKeyNonExtractable(pkcs8)

  return {
    publicKeyBase64,
    encryptedPrivateKeyBase64,
    saltBase64: arrayBufferToBase64(salt),
    kdfVersion: KDF_VERSION,
    privateKey,
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
  publicKeyBase64: string,
  kdfVersion: number = KDF_VERSION
): Promise<{ privateKey: CryptoKey; publicKey: CryptoKey }> {
  const salt = new Uint8Array(base64ToArrayBuffer(saltBase64))
  const kek = await deriveKEK(vaultPassword, salt, kdfVersion)
  const privateKey = await importEncryptedPrivateKey(encryptedPrivateKeyBase64, kek)
  const publicKey = await importPublicKey(publicKeyBase64)
  return { privateKey, publicKey }
}

export interface RewrappedPrivateKey {
  encryptedPrivateKeyBase64: string
  saltBase64: string
  kdfVersion: number
}

/**
 * Change the vault password: unwrap the private key with the current password
 * and wrap it again with a new salt, new password and the current KDF version.
 * The key pair itself does not change, so stored credentials stay readable.
 * Throws when the current password is wrong.
 */
export async function rewrapPrivateKey(
  currentPassword: string,
  newPassword: string,
  saltBase64: string,
  encryptedPrivateKeyBase64: string,
  kdfVersion: number = KDF_VERSION
): Promise<RewrappedPrivateKey> {
  const currentSalt = new Uint8Array(base64ToArrayBuffer(saltBase64))
  const currentKek = await deriveKEK(currentPassword, currentSalt, kdfVersion)
  const pkcs8 = await unwrapPkcs8(encryptedPrivateKeyBase64, currentKek)

  const newSalt = generateSalt()
  const newKek = await deriveKEK(newPassword, newSalt, KDF_VERSION)
  return {
    encryptedPrivateKeyBase64: await wrapPkcs8(pkcs8, newKek),
    saltBase64: arrayBufferToBase64(newSalt),
    kdfVersion: KDF_VERSION,
  }
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
 * Hybrid-encrypt a credential: random AES-256 key for the data, RSA-OAEP for
 * the AES key. Returns wrapped_key_len(2) | wrapped_key | iv | ciphertext.
 */
async function encryptBody(
  credential: CredentialData,
  publicKey: CryptoKey,
  additionalData?: Bytes
): Promise<Bytes> {
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
    additionalData ? { name: AES_ALGORITHM, iv, additionalData } : { name: AES_ALGORITHM, iv },
    aesKey,
    plaintext
  )

  // Export and wrap AES key with RSA public key
  const rawAesKey = await crypto.subtle.exportKey('raw', aesKey)
  const wrappedKey = await crypto.subtle.encrypt({ name: RSA_ALGORITHM }, publicKey, rawAesKey)

  // Pack: wrapped_key_length (2 bytes) + wrapped_key + iv + ciphertext
  const wrappedKeyBytes = new Uint8Array(wrappedKey)
  const ciphertextBytes = new Uint8Array(ciphertext)
  const combined = new Uint8Array(2 + wrappedKeyBytes.length + IV_LENGTH + ciphertextBytes.length)
  combined[0] = (wrappedKeyBytes.length >> 8) & 0xff
  combined[1] = wrappedKeyBytes.length & 0xff
  combined.set(wrappedKeyBytes, 2)
  combined.set(iv, 2 + wrappedKeyBytes.length)
  combined.set(ciphertextBytes, 2 + wrappedKeyBytes.length + IV_LENGTH)
  return combined
}

async function decryptBody(
  body: Bytes,
  privateKey: CryptoKey,
  additionalData?: Bytes
): Promise<CredentialData> {
  // Unpack
  const wrappedKeyLen = (body[0] << 8) | body[1]
  const wrappedKey = body.slice(2, 2 + wrappedKeyLen)
  const iv = body.slice(2 + wrappedKeyLen, 2 + wrappedKeyLen + IV_LENGTH)
  const ciphertext = body.slice(2 + wrappedKeyLen + IV_LENGTH)

  // Unwrap AES key with RSA private key
  const rawAesKey = await crypto.subtle.decrypt({ name: RSA_ALGORITHM }, privateKey, wrappedKey)

  // Import AES key
  const aesKey = await crypto.subtle.importKey(
    'raw',
    rawAesKey,
    { name: AES_ALGORITHM, length: AES_KEY_LENGTH },
    false,
    ['decrypt']
  )

  // Decrypt credential data (GCM verifies the tag and the additional data)
  const plaintext = await crypto.subtle.decrypt(
    additionalData ? { name: AES_ALGORITHM, iv, additionalData } : { name: AES_ALGORITHM, iv },
    aesKey,
    ciphertext
  )

  return JSON.parse(new TextDecoder().decode(plaintext)) as CredentialData
}

/** Blob format version of a stored credential (1 = legacy, 2 = id-bound). */
export function credentialBlobVersion(encryptedData: string): 1 | 2 {
  const bytes = new Uint8Array(base64ToArrayBuffer(encryptedData))
  return bytes.length >= 2 && bytes[0] === BLOB_MAGIC && bytes[1] === BLOB_VERSION_2 ? 2 : 1
}

/**
 * Encrypt credential data (v2 format), binding the ciphertext to `credentialId`.
 * The same id must be supplied to decrypt; a blob copied to another credential
 * row fails authentication.
 */
export async function encryptCredential(
  credential: CredentialData,
  publicKey: CryptoKey,
  credentialId: string
): Promise<string> {
  if (!credentialId) {
    throw new Error('encryptCredential requires the credential id to bind the ciphertext')
  }
  const body = await encryptBody(credential, publicKey, new TextEncoder().encode(credentialId))
  const combined = new Uint8Array(2 + body.length)
  combined[0] = BLOB_MAGIC
  combined[1] = BLOB_VERSION_2
  combined.set(body, 2)
  return arrayBufferToBase64(combined)
}

/**
 * Produce a legacy v1 blob (no id binding). Only for tests and migration
 * tooling; application code must use encryptCredential.
 * @deprecated
 */
export async function encryptCredentialLegacy(
  credential: CredentialData,
  publicKey: CryptoKey
): Promise<string> {
  return arrayBufferToBase64(await encryptBody(credential, publicKey))
}

/**
 * Decrypt credential data. v2 blobs require the credential id they were bound
 * to; v1 blobs are decrypted without binding.
 */
export async function decryptCredential(
  encryptedData: string,
  privateKey: CryptoKey,
  credentialId?: string
): Promise<CredentialData> {
  try {
    const combined = new Uint8Array(base64ToArrayBuffer(encryptedData))

    if (combined.length >= 2 && combined[0] === BLOB_MAGIC && combined[1] === BLOB_VERSION_2) {
      if (!credentialId) {
        throw new Error('credential id required for a v2 blob')
      }
      return await decryptBody(
        combined.subarray(2),
        privateKey,
        new TextEncoder().encode(credentialId)
      )
    }

    return await decryptBody(combined, privateKey)
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

  return Array.from({ length }, () => charset[randomInt(charset.length)]).join('')
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
