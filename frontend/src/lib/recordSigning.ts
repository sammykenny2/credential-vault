/**
 * Record signatures (ADR-004).
 *
 * RSA-OAEP and AES-GCM protect confidentiality, but the RSA public key is public:
 * anyone with database access can produce a blob that decrypts cleanly. The vault's
 * ECDSA key signs the ciphertext hash and the status the server keeps in plaintext,
 * and browsers verify with the key from the KEK-protected bundle before decrypting.
 *
 * What this does not catch: a server replaying an older signed version of a record,
 * or hiding a record. Signatures prove who wrote a state, not that it is the latest.
 */

import { arrayBufferToBase64, base64ToArrayBuffer, type VaultSigner } from './crypto'

export type RecordOrigin = 'authored' | 'legacy-unverified'

export const RECORD_SIGNATURE_VERSION = 1

const RECORD_SIGNATURE_DOMAIN = 'credential-vault/record-signature'
const ECDSA_SIGN_PARAMS = { name: 'ECDSA', hash: 'SHA-256' } as const
const SIGNATURE_BYTES = 64
const MAX_OFFSET_MINUTES = 14 * 60
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const TIMESTAMP_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})?$/

/** Everything a signature covers. */
export interface SignedRecordState {
  id: string
  revision: number
  encrypted_data: string
  is_active: boolean
  expires_at: string | null
  revoked_at: string | null
  origin: RecordOrigin
}

/** A record as the API returns it. Nothing here is trusted until verifyRecord passes. */
export interface StoredRecord extends Omit<SignedRecordState, 'origin'> {
  origin: string | null
  signature: string | null
  signature_version: number | null
}

/** The fields sent alongside a state on every write. */
export interface RecordSignature {
  signature: string
  signature_version: typeof RECORD_SIGNATURE_VERSION
  origin: RecordOrigin
}

export class RecordVerificationError extends Error {
  constructor(message = 'This record failed signature verification, so it was not opened.') {
    super(message)
    this.name = 'RecordVerificationError'
  }
}

/**
 * Epoch milliseconds for a server timestamp. SQLite hands back naive UTC values,
 * so the same instant can arrive as `...Z`, `...+00:00` or with no zone at all.
 */
export function canonicalTimestamp(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null
  const match = typeof value === 'string' ? TIMESTAMP_PATTERN.exec(value) : null
  if (!match) throw new RecordVerificationError()
  const [, year, month, day, hour, minute, second, fraction, zone] = match
  const milliseconds = Number((fraction ?? '').padEnd(3, '0').slice(0, 3))
  const epoch = Date.UTC(
    Number(year), Number(month) - 1, Number(day),
    Number(hour), Number(minute), Number(second), milliseconds
  )
  // Date.UTC rolls over month 13 and maps years below 100 to 19xx: refuse those.
  const parsed = new Date(epoch)
  if (
    parsed.getUTCFullYear() !== Number(year) ||
    parsed.getUTCMonth() !== Number(month) - 1 ||
    parsed.getUTCDate() !== Number(day) ||
    parsed.getUTCHours() !== Number(hour) ||
    parsed.getUTCMinutes() !== Number(minute) ||
    parsed.getUTCSeconds() !== Number(second)
  ) {
    throw new RecordVerificationError()
  }
  if (!zone || zone === 'Z') return epoch
  const offsetMinutes = Number(zone.slice(1, 3)) * 60 + Number(zone.slice(4, 6))
  if (Number(zone.slice(4, 6)) > 59 || offsetMinutes > MAX_OFFSET_MINUTES) {
    throw new RecordVerificationError()
  }
  return epoch - (zone[0] === '+' ? 1 : -1) * offsetMinutes * 60_000
}

/** The exact string a signature covers. JSON of strings, numbers and booleans is injective. */
export async function recordSignatureMessage(
  state: SignedRecordState,
  signer: Pick<VaultSigner, 'vaultId' | 'signerId'>
): Promise<string> {
  if (typeof state.id !== 'string' || !UUID_PATTERN.test(state.id)) {
    throw new RecordVerificationError()
  }
  if (!Number.isSafeInteger(state.revision) || state.revision < 1) {
    throw new RecordVerificationError()
  }
  if (typeof state.is_active !== 'boolean') throw new RecordVerificationError()
  if (state.origin !== 'authored' && state.origin !== 'legacy-unverified') {
    throw new RecordVerificationError()
  }

  let ciphertext: ArrayBuffer
  try {
    ciphertext = base64ToArrayBuffer(state.encrypted_data)
  } catch {
    throw new RecordVerificationError()
  }
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', ciphertext))

  return JSON.stringify([
    RECORD_SIGNATURE_DOMAIN,
    RECORD_SIGNATURE_VERSION,
    signer.vaultId,
    signer.signerId,
    'credential',
    state.id,
    state.revision,
    Array.from(digest).map((b) => b.toString(16).padStart(2, '0')).join(''),
    state.is_active,
    canonicalTimestamp(state.expires_at),
    canonicalTimestamp(state.revoked_at),
    state.origin,
  ])
}

export async function signRecord(
  state: SignedRecordState,
  signer: VaultSigner
): Promise<RecordSignature> {
  const message = await recordSignatureMessage(state, signer)
  const signature = await crypto.subtle.sign(
    ECDSA_SIGN_PARAMS, signer.signingKey, new TextEncoder().encode(message)
  )
  return {
    signature: arrayBufferToBase64(signature),
    signature_version: RECORD_SIGNATURE_VERSION,
    origin: state.origin,
  }
}

/**
 * Verify a record and return its signed origin. Throws RecordVerificationError for
 * an unsigned record or any change to the ciphertext, status, revision or id.
 *
 * Call this before decrypting, and before signing a new state derived from this
 * one: signing over a state that was not verified would launder a forged blob.
 * It proves a state was signed, not that it is the record you asked for, so callers
 * must also compare the id, and must sign only a record the user actually reviewed.
 */
export async function verifyRecord(
  record: StoredRecord,
  signer: VaultSigner
): Promise<RecordOrigin> {
  if (record.signature_version !== RECORD_SIGNATURE_VERSION || typeof record.signature !== 'string') {
    throw new RecordVerificationError()
  }
  let signature: ArrayBuffer
  try {
    signature = base64ToArrayBuffer(record.signature)
  } catch {
    throw new RecordVerificationError()
  }
  if (signature.byteLength !== SIGNATURE_BYTES) throw new RecordVerificationError()

  const origin = record.origin as RecordOrigin
  const message = await recordSignatureMessage({ ...record, origin }, signer)
  const valid = await crypto.subtle.verify(
    ECDSA_SIGN_PARAMS, signer.verifyKey, signature, new TextEncoder().encode(message)
  )
  if (!valid) throw new RecordVerificationError()
  return origin
}
