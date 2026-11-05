/**
 * Record signatures: what a signature covers, and what must fail to verify.
 * All keys and values are synthetic.
 */

import { beforeAll, describe, expect, it } from 'vitest'
import type { VaultSigner } from '@/lib/crypto'
import {
  canonicalTimestamp,
  recordSignatureMessage,
  RecordVerificationError,
  signRecord,
  verifyRecord,
  type SignedRecordState,
  type StoredRecord,
} from '@/lib/recordSigning'
import vectors from './fixtures/vault_signature_vectors.json'

const ECDSA = { name: 'ECDSA', namedCurve: 'P-256' } as const

async function newSigner(): Promise<VaultSigner> {
  const pair = await crypto.subtle.generateKey(ECDSA, false, ['sign', 'verify'])
  return {
    signingKey: pair.privateKey,
    verifyKey: pair.publicKey,
    vaultId: '11111111-2222-4333-8444-555555555555',
    signerId: 'a'.repeat(64),
  }
}

const STATE: SignedRecordState = {
  id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
  revision: 2,
  encrypted_data: btoa('synthetic-ciphertext'),
  is_active: true,
  expires_at: '2027-01-01T00:00:00.000Z',
  revoked_at: null,
  origin: 'authored',
}

let signer: VaultSigner
let record: StoredRecord

beforeAll(async () => {
  signer = await newSigner()
  const signed = await signRecord(STATE, signer)
  record = { ...STATE, ...signed }
})

describe('verifyRecord', () => {
  it('accepts an untouched record and returns its signed origin', async () => {
    expect(await verifyRecord(record, signer)).toBe('authored')
  })

  it('returns the legacy-unverified origin when that is what was signed', async () => {
    const state: SignedRecordState = { ...STATE, origin: 'legacy-unverified' }
    const stored = { ...state, ...(await signRecord(state, signer)) }
    expect(await verifyRecord(stored, signer)).toBe('legacy-unverified')
  })

  it.each([
    ['ciphertext', { encrypted_data: btoa('forged-ciphertext') }],
    ['revision (rollback marker)', { revision: 1 }],
    ['revision (skip ahead)', { revision: 3 }],
    ['active flag', { is_active: false }],
    ['expiry', { expires_at: '2030-01-01T00:00:00Z' }],
    ['removed expiry', { expires_at: null }],
    ['revocation time', { revoked_at: '2026-01-01T00:00:00Z' }],
    ['origin upgrade', { origin: 'legacy-unverified' }],
    ['id (record moved to another row)', { id: 'bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee' }],
  ])('rejects a changed %s', async (_label, change) => {
    await expect(verifyRecord({ ...record, ...change }, signer)).rejects.toBeInstanceOf(
      RecordVerificationError
    )
  })

  it('rejects a legacy-unverified record relabelled as authored', async () => {
    const state: SignedRecordState = { ...STATE, origin: 'legacy-unverified' }
    const stored = { ...state, ...(await signRecord(state, signer)) }
    await expect(verifyRecord({ ...stored, origin: 'authored' }, signer)).rejects.toBeInstanceOf(
      RecordVerificationError
    )
  })

  it('rejects a record forged with only public information', async () => {
    // Anything encrypted to the public RSA key decrypts cleanly. Without the
    // signing key the attacker has no valid signature to attach.
    const forged: StoredRecord = {
      ...STATE,
      encrypted_data: btoa('attacker-encrypted-to-public-key'),
      signature: null,
      signature_version: null,
      origin: null,
    }
    await expect(verifyRecord(forged, signer)).rejects.toBeInstanceOf(RecordVerificationError)
  })

  it('rejects a signature from another vault key', async () => {
    const other = await newSigner()
    const stored = { ...STATE, ...(await signRecord(STATE, other)) }
    await expect(verifyRecord(stored, signer)).rejects.toBeInstanceOf(RecordVerificationError)
  })

  it('rejects a valid signature made for another vault id', async () => {
    const stored = {
      ...STATE,
      ...(await signRecord(STATE, { ...signer, vaultId: '99999999-2222-4333-8444-555555555555' })),
    }
    await expect(verifyRecord(stored, signer)).rejects.toBeInstanceOf(RecordVerificationError)
  })

  it.each([
    ['no signature', { signature: null }],
    ['no version', { signature_version: null }],
    ['unknown version', { signature_version: 2 }],
    ['invalid base64', { signature: '***' }],
    ['wrong length', { signature: btoa('short') }],
    ['unknown origin', { origin: 'trusted' }],
    ['no origin', { origin: null }],
    ['invalid ciphertext encoding', { encrypted_data: '***' }],
    ['non-boolean active flag', { is_active: 'true' as unknown as boolean }],
    ['fractional revision', { revision: 1.5 }],
    ['invalid timestamp', { expires_at: 'tomorrow' }],
    ['uppercase id', { id: STATE.id.toUpperCase() }],
    ['id that only stringifies to a uuid', { id: [STATE.id] as unknown as string }],
  ])('rejects %s', async (_label, change) => {
    await expect(verifyRecord({ ...record, ...change }, signer)).rejects.toBeInstanceOf(
      RecordVerificationError
    )
  })
})

describe('canonicalTimestamp', () => {
  const EPOCH = Date.UTC(2027, 0, 1, 12, 30, 15, 250)

  it.each([
    '2027-01-01T12:30:15.250Z',
    '2027-01-01T12:30:15.25Z',
    '2027-01-01T12:30:15.250000',
    '2027-01-01T12:30:15.250+00:00',
    '2027-01-01T20:30:15.250+08:00',
    '2027-01-01T04:30:15.250-08:00',
  ])('reads %s as the same instant', (value) => {
    expect(canonicalTimestamp(value)).toBe(EPOCH)
  })

  it('reads a value with no zone as UTC, which is how SQLite returns it', () => {
    expect(canonicalTimestamp('2027-01-01T12:30:15')).toBe(Date.UTC(2027, 0, 1, 12, 30, 15))
  })

  it('keeps null distinct from any instant', () => {
    expect(canonicalTimestamp(null)).toBeNull()
    expect(canonicalTimestamp(undefined)).toBeNull()
  })

  it.each([
    '',
    'tomorrow',
    '2027-01-01',
    '2027-01-01 12:30:15',
    '2027-01-01T12:30:15+0800',
    '2027-13-01T00:00:00Z',
    '2027-02-30T00:00:00Z',
    '2027-01-01T24:00:00Z',
    '2027-01-01T00:60:00Z',
    '2027-01-01T00:00:99Z',
    '0099-01-01T00:00:00Z',
    '2027-01-01T00:00:00+99:99',
    '2027-01-01T00:00:00+14:01',
    '2027-01-01T00:00:00+01:60',
  ])(
    'rejects %j',
    (value) => {
      expect(() => canonicalTimestamp(value)).toThrow(RecordVerificationError)
    }
  )

  it('survives the server rewriting the timestamp format', async () => {
    const stored = { ...record, expires_at: '2027-01-01T00:00:00' }
    expect(await verifyRecord(stored, signer)).toBe('authored')
  })
})

describe('shared test vector', () => {
  const vector = vectors.record
  const state = vector.state as SignedRecordState

  async function vectorSigner(): Promise<Pick<VaultSigner, 'vaultId' | 'signerId'> & { key: CryptoKey }> {
    const spki = Uint8Array.from(atob(vector.spki), (c) => c.charCodeAt(0))
    return {
      vaultId: vector.vault_id,
      signerId: vector.signer_id,
      key: await crypto.subtle.importKey('spki', spki, ECDSA, true, ['verify']),
    }
  }

  it('fixes the signed message format', async () => {
    const { vaultId, signerId } = await vectorSigner()
    expect(await recordSignatureMessage(state, { vaultId, signerId })).toBe(vector.message)
  })

  it('verifies a stored signature, so a format change cannot pass unnoticed', async () => {
    const { vaultId, signerId, key } = await vectorSigner()
    const stored: StoredRecord = { ...state, signature: vector.signature, signature_version: 1 }
    const verifying: VaultSigner = {
      signingKey: key,
      verifyKey: key,
      vaultId,
      signerId,
    }
    expect(await verifyRecord(stored, verifying)).toBe('legacy-unverified')
  })
})
