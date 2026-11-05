/**
 * Client-side E2EE encryption utilities using Web Crypto API.
 *
 * Hybrid encryption scheme:
 * - RSA-OAEP (2048-bit) for wrapping per-credential AES keys
 * - AES-256-GCM for encrypting credential data
 * - Argon2id (via hash-wasm) for deriving key-encryption-key from vault password
 * - ECDSA P-256 for signing records, because anyone holding the public RSA key
 *   can produce a blob that decrypts cleanly (see recordSigning.ts)
 *
 * Flow:
 * 1. User creates vault password -> derive KEK via Argon2id
 * 2. Generate the RSA-OAEP and ECDSA key pairs
 * 3. Encrypt both private keys and the verification key with the KEK -> key
 *    bundle, stored on the server. The KEK is the root of trust: a server that
 *    replaces the bundle cannot produce one that authenticates under it.
 * 4. Export public keys -> store on server (plaintext). Browsers do not trust
 *    these copies: they use the keys derived from the bundle.
 * 5. Encrypt credential: generate random AES key, encrypt data, wrap AES key with RSA public key
 * 6. Decrypt credential: verify the record signature, then unwrap and decrypt
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

const ECDSA_PARAMS = { name: 'ECDSA', namedCurve: 'P-256' } as const

/** Current blob format: magic byte + version byte prefix. */
const BLOB_MAGIC = 0xff
const BLOB_VERSION_2 = 0x02

/**
 * Key bundle format, stored base64 in users.encrypted_private_key:
 *   ASCII("CVKB") | version(1) | iv(12) | AES-GCM(KEK, plaintext)
 * plaintext = vault_id(16) | u16 len | RSA PKCS8 | u16 len | ECDSA PKCS8 | u16 len | ECDSA SPKI
 * A vault that has not been upgraded holds base64(iv | AES-GCM(KEK, RSA PKCS8)).
 */
const KEY_BUNDLE_MAGIC = [0x43, 0x56, 0x4b, 0x42]
const KEY_BUNDLE_VERSION = 1
const KEY_BUNDLE_HEADER_LENGTH = KEY_BUNDLE_MAGIC.length + 1
const VAULT_ID_BYTES = 16
const KEY_BUNDLE_AAD = new TextEncoder().encode(
  JSON.stringify(['credential-vault/key-bundle', KEY_BUNDLE_VERSION])
)

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

/**
 * The server returned key material that does not match the KEK-protected keys.
 * This is a security event, not a typo: never report it as a wrong password.
 */
export class VaultKeyMismatchError extends Error {
  constructor(
    message = 'The server returned vault keys that do not match your encrypted private key. ' +
      'Your password is not the problem. The vault stayed locked and nothing was sent.'
  ) {
    super(message)
    this.name = 'VaultKeyMismatchError'
  }
}

/** Signs records and proofs. Held in memory only while the vault is unlocked. */
export interface VaultSigner {
  /** Non-extractable; usable only for signing. */
  signingKey: CryptoKey
  /** Comes from the KEK-protected bundle, never from the API. */
  verifyKey: CryptoKey
  vaultId: string
  /** SHA-256 of the verification key (hex). */
  signerId: string
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')
}

function formatVaultId(bytes: Uint8Array): string {
  const hex = bytesToHex(bytes)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

interface KeyBundle {
  vaultId: Bytes
  rsaPkcs8: Bytes
  signingPkcs8: Bytes
  verifySpki: Bytes
}

function encodeKeyBundle(bundle: KeyBundle): Bytes {
  const parts = [bundle.rsaPkcs8, bundle.signingPkcs8, bundle.verifySpki]
  const encoded = new Uint8Array(
    VAULT_ID_BYTES + parts.reduce((total, part) => total + 2 + part.length, 0)
  )
  encoded.set(bundle.vaultId, 0)
  let offset = VAULT_ID_BYTES
  for (const part of parts) {
    encoded[offset] = part.length >> 8
    encoded[offset + 1] = part.length & 0xff
    encoded.set(part, offset + 2)
    offset += 2 + part.length
  }
  return encoded
}

/** Views into `encoded`; the caller keeps it alive and wipes it when done. */
function decodeKeyBundle(encoded: Bytes): KeyBundle {
  if (encoded.length < VAULT_ID_BYTES) throw new VaultKeyMismatchError()
  const read = (start: number): { part: Bytes; end: number } => {
    if (start + 2 > encoded.length) throw new VaultKeyMismatchError()
    const length = (encoded[start] << 8) | encoded[start + 1]
    const end = start + 2 + length
    if (length === 0 || end > encoded.length) throw new VaultKeyMismatchError()
    return { part: encoded.subarray(start + 2, end), end }
  }
  const rsa = read(VAULT_ID_BYTES)
  const signing = read(rsa.end)
  const verify = read(signing.end)
  if (verify.end !== encoded.length) throw new VaultKeyMismatchError()
  return {
    vaultId: encoded.subarray(0, VAULT_ID_BYTES),
    rsaPkcs8: rsa.part,
    signingPkcs8: signing.part,
    verifySpki: verify.part,
  }
}

function hasKeyBundleMagic(blob: Uint8Array): boolean {
  return blob.length >= KEY_BUNDLE_HEADER_LENGTH &&
    KEY_BUNDLE_MAGIC.every((byte, index) => blob[index] === byte)
}

async function wrapKeyBundle(bundle: KeyBundle, kek: CryptoKey): Promise<string> {
  const iv = generateIV()
  const plaintext = encodeKeyBundle(bundle)
  try {
    const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
      { name: AES_ALGORITHM, iv, additionalData: KEY_BUNDLE_AAD }, kek, plaintext
    ))
    const combined = new Uint8Array(KEY_BUNDLE_HEADER_LENGTH + iv.length + ciphertext.length)
    combined.set(KEY_BUNDLE_MAGIC, 0)
    combined[KEY_BUNDLE_MAGIC.length] = KEY_BUNDLE_VERSION
    combined.set(iv, KEY_BUNDLE_HEADER_LENGTH)
    combined.set(ciphertext, KEY_BUNDLE_HEADER_LENGTH + iv.length)
    return arrayBufferToBase64(combined)
  } finally {
    plaintext.fill(0)
  }
}

/** Throws when the KEK is wrong (GCM tag mismatch). The caller wipes the result. */
async function unwrapKeyBundle(blob: Uint8Array, kek: CryptoKey): Promise<Bytes> {
  if (blob[KEY_BUNDLE_MAGIC.length] !== KEY_BUNDLE_VERSION) {
    throw new Error(`Unsupported vault key bundle version: ${blob[KEY_BUNDLE_MAGIC.length]}`)
  }
  const iv = blob.slice(KEY_BUNDLE_HEADER_LENGTH, KEY_BUNDLE_HEADER_LENGTH + IV_LENGTH)
  const ciphertext = blob.slice(KEY_BUNDLE_HEADER_LENGTH + IV_LENGTH)
  return new Uint8Array(await crypto.subtle.decrypt(
    { name: AES_ALGORITHM, iv, additionalData: KEY_BUNDLE_AAD }, kek, ciphertext
  ))
}

/** Import the signing keys and confirm that they belong together. */
async function signerFromBundle(bundle: KeyBundle): Promise<VaultSigner> {
  const signingKey = await crypto.subtle.importKey(
    'pkcs8', bundle.signingPkcs8, ECDSA_PARAMS, false, ['sign']
  )
  const verifyKey = await crypto.subtle.importKey(
    'spki', bundle.verifySpki, ECDSA_PARAMS, true, ['verify']
  )

  const probe = new TextEncoder().encode('credential-vault/key-bundle-self-test')
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: RSA_HASH }, signingKey, probe)
  const matches = await crypto.subtle.verify(
    { name: 'ECDSA', hash: RSA_HASH }, verifyKey, signature, probe
  )
  if (!matches) throw new VaultKeyMismatchError()

  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bundle.verifySpki))
  return {
    signingKey,
    verifyKey,
    vaultId: formatVaultId(bundle.vaultId),
    signerId: bytesToHex(digest),
  }
}

interface NewSigningMaterial {
  vaultId: Bytes
  signingPkcs8: Bytes
  verifySpki: Bytes
  signingPublicKeyBase64: string
}

async function generateSigningMaterial(): Promise<NewSigningMaterial> {
  const pair = await crypto.subtle.generateKey(ECDSA_PARAMS, true, ['sign', 'verify'])
  const verifySpki = new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey))
  return {
    vaultId: crypto.getRandomValues(new Uint8Array(VAULT_ID_BYTES)),
    signingPkcs8: new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey)),
    verifySpki,
    signingPublicKeyBase64: arrayBufferToBase64(verifySpki),
  }
}

/** Derive the public components from authenticated private-key material. */
async function publicKeyFromPrivateKey(pkcs8: ArrayBuffer): Promise<CryptoKey> {
  // This temporary key is exportable only to obtain its public RSA components.
  // The session private key is imported separately as non-extractable.
  const temporaryKey = await crypto.subtle.importKey(
    'pkcs8', pkcs8, { name: RSA_ALGORITHM, hash: RSA_HASH }, true, ['decrypt']
  )
  const jwk = await crypto.subtle.exportKey('jwk', temporaryKey)
  try {
    if (!jwk.n || !jwk.e) throw new Error('Invalid vault RSA private key')
    return await crypto.subtle.importKey(
      'jwk',
      { kty: 'RSA', n: jwk.n, e: jwk.e },
      { name: RSA_ALGORITHM, hash: RSA_HASH },
      true,
      ['encrypt']
    )
  } finally {
    // Release references; JavaScript strings cannot be securely erased.
    delete jwk.d
    delete jwk.p
    delete jwk.q
    delete jwk.dp
    delete jwk.dq
    delete jwk.qi
    delete jwk.oth
  }
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
  /** The key bundle. */
  encryptedPrivateKeyBase64: string
  saltBase64: string
  kdfVersion: number
  signingPublicKeyBase64: string
  /** Non-extractable; safe to keep in memory for the session. */
  privateKey: CryptoKey
  publicKey: CryptoKey
  signer: VaultSigner
}

/**
 * Set up a new E2EE vault. Generates the key pairs and encrypts them with the vault password.
 * A new vault is signed from the start, so it never holds an unsigned record.
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

  // Export the private keys once: wrap them for the server and re-import them
  // non-extractable for the in-memory session copy.
  const rsaPkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', keyPair.privateKey))
  const signing = await generateSigningMaterial()
  const bundle: KeyBundle = {
    vaultId: signing.vaultId,
    rsaPkcs8,
    signingPkcs8: signing.signingPkcs8,
    verifySpki: signing.verifySpki,
  }
  try {
    return {
      publicKeyBase64,
      encryptedPrivateKeyBase64: await wrapKeyBundle(bundle, kek),
      saltBase64: arrayBufferToBase64(salt),
      kdfVersion: KDF_VERSION,
      signingPublicKeyBase64: signing.signingPublicKeyBase64,
      privateKey: await importPrivateKeyNonExtractable(rsaPkcs8.buffer),
      publicKey: keyPair.publicKey,
      signer: await signerFromBundle(bundle),
    }
  } finally {
    rsaPkcs8.fill(0)
    signing.signingPkcs8.fill(0)
  }
}

/** Everything needed to upgrade an RSA-only vault later, without keeping private keys around. */
export interface PendingVaultUpgrade {
  kek: CryptoKey
  encryptedPrivateKeyBase64: string
}

export interface UnlockedVault {
  privateKey: CryptoKey
  publicKey: CryptoKey
  publicKeyBase64: string
  /** Null until an RSA-only vault has been upgraded. */
  signer: VaultSigner | null
  pendingUpgrade: PendingVaultUpgrade | null
}

/** Derive the RSA public key from the private key and refuse a different advertised one. */
async function verifiedPublicKey(
  pkcs8: ArrayBuffer,
  advertisedBase64: string
): Promise<{ publicKey: CryptoKey; publicKeyBase64: string }> {
  const publicKey = await publicKeyFromPrivateKey(pkcs8)
  const publicKeyBase64 = await exportPublicKey(publicKey)
  let advertised: string
  try {
    advertised = await exportPublicKey(await importPublicKey(advertisedBase64))
  } catch {
    throw new VaultKeyMismatchError()
  }
  if (advertised !== publicKeyBase64) throw new VaultKeyMismatchError()
  return { publicKey, publicKeyBase64 }
}

/**
 * Unlock an existing vault with the vault password.
 *
 * A wrong password throws an AES-GCM error. Key material that authenticates but
 * does not match what the API advertised throws VaultKeyMismatchError.
 */
export async function unlockVault(
  vaultPassword: string,
  saltBase64: string,
  encryptedPrivateKeyBase64: string,
  publicKeyBase64: string,
  kdfVersion: number = KDF_VERSION
): Promise<UnlockedVault> {
  const salt = new Uint8Array(base64ToArrayBuffer(saltBase64))
  const kek = await deriveKEK(vaultPassword, salt, kdfVersion)
  const blob = new Uint8Array(base64ToArrayBuffer(encryptedPrivateKeyBase64))

  if (hasKeyBundleMagic(blob)) {
    const plaintext = await unwrapKeyBundle(blob, kek)
    try {
      const bundle = decodeKeyBundle(plaintext)
      const rsaPkcs8 = toBytes(bundle.rsaPkcs8)
      try {
        const verified = await verifiedPublicKey(rsaPkcs8.buffer, publicKeyBase64)
        return {
          ...verified,
          privateKey: await importPrivateKeyNonExtractable(rsaPkcs8.buffer),
          signer: await signerFromBundle(bundle),
          pendingUpgrade: null,
        }
      } finally {
        rsaPkcs8.fill(0)
      }
    } finally {
      plaintext.fill(0)
    }
  }

  const pkcs8 = await unwrapPkcs8(encryptedPrivateKeyBase64, kek)
  try {
    const verified = await verifiedPublicKey(pkcs8, publicKeyBase64)
    return {
      ...verified,
      privateKey: await importPrivateKeyNonExtractable(pkcs8),
      signer: null,
      pendingUpgrade: { kek, encryptedPrivateKeyBase64 },
    }
  } finally {
    new Uint8Array(pkcs8).fill(0)
  }
}

export interface VaultUpgradeKeys {
  encryptedPrivateKeyBase64: string
  signingPublicKeyBase64: string
  signer: VaultSigner
}

/** Build the key bundle for an RSA-only vault. Nothing is stored until the caller sends it. */
export async function createVaultUpgradeKeys(pending: PendingVaultUpgrade): Promise<VaultUpgradeKeys> {
  const rsaPkcs8 = new Uint8Array(await unwrapPkcs8(pending.encryptedPrivateKeyBase64, pending.kek))
  const signing = await generateSigningMaterial()
  const bundle: KeyBundle = {
    vaultId: signing.vaultId,
    rsaPkcs8,
    signingPkcs8: signing.signingPkcs8,
    verifySpki: signing.verifySpki,
  }
  try {
    return {
      encryptedPrivateKeyBase64: await wrapKeyBundle(bundle, pending.kek),
      signingPublicKeyBase64: signing.signingPublicKeyBase64,
      signer: await signerFromBundle(bundle),
    }
  } finally {
    rsaPkcs8.fill(0)
    signing.signingPkcs8.fill(0)
  }
}

export interface RewrappedPrivateKey {
  encryptedPrivateKeyBase64: string
  saltBase64: string
  kdfVersion: number
}

/**
 * Change the vault password: unwrap the key bundle with the current password
 * and wrap it again with a new salt, new password and the current KDF version.
 * The keys themselves do not change, so stored credentials and signatures stay
 * valid. Throws when the current password is wrong, and for an RSA-only blob:
 * unlocking upgrades such a vault first, so seeing one here means the server
 * replayed old key material.
 */
export async function rewrapPrivateKey(
  currentPassword: string,
  newPassword: string,
  saltBase64: string,
  encryptedPrivateKeyBase64: string,
  kdfVersion: number = KDF_VERSION,
  expectedPublicKey?: string,
  expectedSigner?: VaultSigner,
): Promise<RewrappedPrivateKey> {
  const currentSalt = new Uint8Array(base64ToArrayBuffer(saltBase64))
  const currentKek = await deriveKEK(currentPassword, currentSalt, kdfVersion)
  const blob = new Uint8Array(base64ToArrayBuffer(encryptedPrivateKeyBase64))
  if (!hasKeyBundleMagic(blob)) throw new VaultKeyMismatchError()

  const plaintext = await unwrapKeyBundle(blob, currentKek)
  try {
    const bundle = decodeKeyBundle(plaintext)
    if (expectedPublicKey) {
      const rsaPkcs8 = toBytes(bundle.rsaPkcs8)
      try { await verifiedPublicKey(rsaPkcs8.buffer, expectedPublicKey) }
      finally { rsaPkcs8.fill(0) }
    }
    if (expectedSigner) {
      const restored = await signerFromBundle(bundle)
      if (restored.vaultId !== expectedSigner.vaultId || restored.signerId !== expectedSigner.signerId) {
        throw new VaultKeyMismatchError()
      }
    }
    const newSalt = generateSalt()
    const newKek = await deriveKEK(newPassword, newSalt, KDF_VERSION)
    return {
      encryptedPrivateKeyBase64: await wrapKeyBundle(bundle, newKek),
      saltBase64: arrayBufferToBase64(newSalt),
      kdfVersion: KDF_VERSION,
    }
  } finally {
    plaintext.fill(0)
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

/**
 * Decrypted content is rendered, so check its shape: a signature only proves who
 * signed it, and a legacy-unverified record may have been planted before the upgrade.
 */
export function assertCredentialData(value: unknown): asserts value is CredentialData {
  const isOptionalString = (field: unknown) => field === undefined || typeof field === 'string'
  const isPlainObject = (field: unknown): field is Record<string, unknown> =>
    typeof field === 'object' && field !== null && !Array.isArray(field)

  if (
    !isPlainObject(value) ||
    typeof value.name !== 'string' ||
    !isOptionalString(value.description) ||
    !isOptionalString(value.website_url) ||
    !isOptionalString(value.category) ||
    !isOptionalString(value.notes) ||
    (value.fields !== undefined &&
      (!isPlainObject(value.fields) ||
        Object.values(value.fields).some((field) => typeof field !== 'string')))
  ) {
    throw new Error('Invalid credential content')
  }
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

  const data: unknown = JSON.parse(new TextDecoder().decode(plaintext))
  assertCredentialData(data)
  return data
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

    // v1 starts with the wrapped key length (0x01 0x00 for RSA-2048), never this
    // marker, so an unknown future version must not reach the unbound v1 parser.
    if (combined.length >= 1 && combined[0] === BLOB_MAGIC) {
      throw new Error('Unsupported credential blob version')
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
