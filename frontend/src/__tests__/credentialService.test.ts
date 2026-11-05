/**
 * credentialService: every write is signed and proven, and a state derived from
 * a stored record is only signed after that record verifies. Keys are synthetic.
 *
 * Run with: npm test
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/services/api', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}))

const PROOF_HEADERS = { 'X-Vault-Proof': 'test-proof' }
vi.mock('@/lib/vaultProof', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/vaultProof')>()),
  vaultProofHeaders: vi.fn(async () => ({ 'X-Vault-Proof': 'test-proof' })),
}))

import api from '@/services/api'
import { credentialService } from '@/services/credentialService'
import { useVaultKeyStore } from '@/hooks/useVaultKey'
import type { VaultSigner } from '@/lib/crypto'
import {
  RecordVerificationError,
  signRecord,
  verifyRecord,
  type SignedRecordState,
} from '@/lib/recordSigning'
import { VaultLockedError } from '@/lib/vaultProof'
import { captureOperation, OperationCancelledError } from '@/lib/operationGuard'
import type { Credential } from '@/types'

const mockedApi = api as unknown as {
  get: ReturnType<typeof vi.fn>
  post: ReturnType<typeof vi.fn>
  patch: ReturnType<typeof vi.fn>
  delete: ReturnType<typeof vi.fn>
}

const BLOB = btoa('encrypted-blob')
const OTHER_BLOB = btoa('other-blob')
const ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const OTHER_ID = 'bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const ECDSA = { name: 'ECDSA', namedCurve: 'P-256' } as const

let signer: VaultSigner

async function newSigner(): Promise<VaultSigner> {
  const pair = await crypto.subtle.generateKey(ECDSA, false, ['sign', 'verify'])
  return {
    signingKey: pair.privateKey,
    verifyKey: pair.publicKey,
    vaultId: '11111111-2222-4333-8444-555555555555',
    signerId: 'a'.repeat(64),
  }
}

function asRow(state: SignedRecordState, signature: string | null): Credential {
  return {
    ...state,
    signature,
    signature_version: signature ? 1 : null,
    created_at: '2026-01-01T00:00:00',
    updated_at: '2026-01-01T00:00:00',
  }
}

async function storedRow(overrides: Partial<SignedRecordState> = {}, key = signer): Promise<Credential> {
  const state: SignedRecordState = {
    id: ID,
    revision: 1,
    encrypted_data: BLOB,
    is_active: true,
    expires_at: null,
    revoked_at: null,
    origin: 'authored',
    ...overrides,
  }
  return asRow(state, (await signRecord(state, key)).signature)
}

/** Answer a read-back with whatever the client just sent, as a real server would. */
function serveWhatWasSent(call: ReturnType<typeof vi.fn>, base: Credential) {
  call.mockImplementation(async (_url: string, body: Partial<Credential>) => {
    const row = { ...base, ...body }
    mockedApi.get.mockResolvedValue({ data: row })
    return { data: row }
  })
}

beforeAll(async () => {
  signer = await newSigner()
})

beforeEach(() => {
  vi.clearAllMocks()
  mockedApi.get.mockReset()
  mockedApi.post.mockReset()
  mockedApi.patch.mockReset()
  mockedApi.delete.mockReset()
  useVaultKeyStore.getState().setKeys({} as CryptoKey, {} as CryptoKey, 'pub', signer)
})

afterEach(() => {
  useVaultKeyStore.getState().clearKeys()
})

describe('create()', () => {
  beforeEach(() => {
    serveWhatWasSent(mockedApi.post, asRow(
      { id: ID, revision: 1, encrypted_data: BLOB, is_active: true, expires_at: null, revoked_at: null, origin: 'authored' },
      null
    ))
  })

  it('sends a signed record with a proof, at revision 1', async () => {
    const result = await credentialService.create({ id: ID, encrypted_data: BLOB })

    const [url, body, config] = mockedApi.post.mock.calls[0]
    expect(url).toBe('/credentials/')
    expect(config).toEqual({ headers: PROOF_HEADERS, assertOperation: expect.any(Function) })
    expect(body.revision).toBe(1)
    expect(body.origin).toBe('authored')
    expect(body.signature_version).toBe(1)
    expect(await verifyRecord(result, signer)).toBe('authored')
    expect(mockedApi.get).toHaveBeenCalledWith(`/credentials/${ID}`, { assertOperation: expect.any(Function) })
  })

  it('signs the expiry it sends', async () => {
    const result = await credentialService.create({
      id: ID,
      encrypted_data: BLOB,
      expires_at: '2027-06-01',
    })

    expect(mockedApi.post.mock.calls[0][1].expires_at).toBe('2027-06-01T00:00:00.000Z')
    expect(await verifyRecord(result, signer)).toBe('authored')
  })

  it('refuses while the vault is locked, before sending anything', async () => {
    useVaultKeyStore.getState().clearKeys()

    await expect(
      credentialService.create({ id: ID, encrypted_data: BLOB })
    ).rejects.toBeInstanceOf(VaultLockedError)
    expect(mockedApi.post).not.toHaveBeenCalled()
  })

  it('reports a differing re-read without sending a destructive cleanup request', async () => {
    mockedApi.post.mockResolvedValue({ data: {} })
    mockedApi.get.mockResolvedValue({ data: await storedRow({ encrypted_data: OTHER_BLOB }) })
    mockedApi.delete.mockResolvedValue({})

    await expect(
      credentialService.create({ id: ID, encrypted_data: BLOB })
    ).rejects.toThrow('Storage integrity check failed')

    expect(mockedApi.delete).not.toHaveBeenCalled()
  })

  it('leaves the stored record alone when the re-read is not what was signed', async () => {
    mockedApi.post.mockResolvedValue({ data: {} })
    mockedApi.get.mockResolvedValue({ data: await storedRow({}, await newSigner()) })
    mockedApi.delete.mockResolvedValue({})

    await expect(
      credentialService.create({ id: ID, encrypted_data: BLOB })
    ).rejects.toThrow('Storage integrity check failed')

    expect(mockedApi.delete).not.toHaveBeenCalled()
  })

  it('refuses a read-back of another record', async () => {
    mockedApi.post.mockResolvedValue({ data: {} })
    mockedApi.get.mockResolvedValue({ data: await storedRow({ id: OTHER_ID }) })
    mockedApi.delete.mockResolvedValue({})

    await expect(
      credentialService.create({ id: ID, encrypted_data: BLOB })
    ).rejects.toBeInstanceOf(RecordVerificationError)
  })
})

describe('get()', () => {
  it('refuses a validly signed record that is not the one requested', async () => {
    mockedApi.get.mockResolvedValue({ data: await storedRow({ id: OTHER_ID }) })
    await expect(credentialService.get(ID)).rejects.toBeInstanceOf(RecordVerificationError)
  })
})

describe('writes derived from a record the user reviewed', () => {
  it.each([
    ['revoke', (row: Credential) => credentialService.revoke(row)],
    ['confirmOrigin', (row: Credential) => credentialService.confirmOrigin(row)],
  ])('%s refuses to sign over a record that fails verification', async (_label, write) => {
    // Signing here would launder a blob the server forged.
    const forged = asRow(
      { id: ID, revision: 1, encrypted_data: btoa('forged'), is_active: true, expires_at: null, revoked_at: null, origin: 'authored' },
      null
    )
    const sign = vi.spyOn(crypto.subtle, 'sign')

    await expect(write(forged)).rejects.toBeInstanceOf(RecordVerificationError)

    expect(sign).not.toHaveBeenCalled()
    expect(mockedApi.patch).not.toHaveBeenCalled()
    expect(mockedApi.post).not.toHaveBeenCalled()
    sign.mockRestore()
  })

  it.each([
    ['revoke', (row: Credential) => credentialService.revoke(row)],
    ['confirmOrigin', (row: Credential) => credentialService.confirmOrigin(row)],
  ])('%s signs the reviewed record, not a fresh answer from the server', async (_label, write) => {
    // The attack: answer a GET with another validly signed record, so the browser
    // signs that one as if the user had chosen it. There must be no such GET to answer.
    const reviewed = await storedRow({ origin: 'legacy-unverified' })
    const planted = await storedRow({ id: OTHER_ID, encrypted_data: btoa('planted'), origin: 'legacy-unverified' })
    const signedBlobs: string[] = []
    const send = async (_url: string, body: Partial<Credential>) => {
      signedBlobs.push(body.signature as string)
      return { data: {} }
    }
    mockedApi.patch.mockImplementation(send)
    mockedApi.post.mockImplementation(send)
    mockedApi.get.mockResolvedValue({ data: planted })

    // The read-back gets the planted record too, and must not be accepted.
    await expect(write(reviewed)).rejects.toBeInstanceOf(RecordVerificationError)

    // Only the read-back fetched anything, and the one signature made covers the reviewed blob.
    expect(mockedApi.get).toHaveBeenCalledTimes(1)
    expect(signedBlobs).toHaveLength(1)
    const url = (mockedApi.patch.mock.calls[0] ?? mockedApi.post.mock.calls[0])[0]
    expect(url).toContain(ID)
    expect(url).not.toContain(OTHER_ID)
    const sent = mockedApi.patch.mock.calls[0]?.[1] ?? mockedApi.post.mock.calls[0]?.[1]
    await expect(verifyRecord(
      { ...reviewed, ...sent, is_active: sent.revoked_at ? false : true },
      signer
    )).resolves.toBeDefined()
    await expect(verifyRecord(
      { ...planted, ...sent, is_active: sent.revoked_at ? false : true },
      signer
    )).rejects.toBeInstanceOf(RecordVerificationError)
  })

  it.each([
    ['revoke', (row: Credential) => credentialService.revoke(row)],
    ['confirmOrigin', (row: Credential) => credentialService.confirmOrigin(row)],
  ])('%s reports a write the server dropped', async (_label, write) => {
    // The server answers 200 and keeps serving the old, validly signed row.
    const reviewed = await storedRow()
    mockedApi.patch.mockResolvedValue({ data: {} })
    mockedApi.post.mockResolvedValue({ data: {} })
    mockedApi.get.mockResolvedValue({ data: reviewed })

    await expect(write(reviewed)).rejects.toThrow('Storage integrity check failed')
  })

  it.each([
    ['revoke', (row: Credential) => credentialService.revoke(row)],
    ['confirmOrigin', (row: Credential) => credentialService.confirmOrigin(row)],
  ])('%s refuses while the vault is locked', async (_label, write) => {
    const reviewed = await storedRow()
    useVaultKeyStore.getState().clearKeys()
    await expect(write(reviewed)).rejects.toBeInstanceOf(VaultLockedError)
    expect(mockedApi.patch).not.toHaveBeenCalled()
    expect(mockedApi.post).not.toHaveBeenCalled()
  })

  it('does not write the old blob back after a failed re-read', async () => {
    // Rolling back could overwrite someone else's newer revision.
    const reviewed = await storedRow()
    mockedApi.patch.mockResolvedValue({ data: {} })
    mockedApi.get.mockResolvedValue({ data: await storedRow({ encrypted_data: btoa('corrupt') }) })

    await expect(credentialService.confirmOrigin(reviewed)).rejects.toThrow('Storage integrity check failed')

    expect(mockedApi.patch).toHaveBeenCalledTimes(1)
  })
})

describe('confirmOrigin()', () => {
  it('moves a verified legacy record to authored without touching the ciphertext', async () => {
    const reviewed = await storedRow({ origin: 'legacy-unverified' })
    serveWhatWasSent(mockedApi.patch, reviewed)

    const result = await credentialService.confirmOrigin(reviewed)

    const [url, body, config] = mockedApi.patch.mock.calls[0]
    expect(url).toBe(`/credentials/${ID}`)
    expect(config).toEqual({ headers: PROOF_HEADERS, assertOperation: expect.any(Function) })
    expect(body).not.toHaveProperty('encrypted_data')
    expect(body.revision).toBe(2)
    expect(body.origin).toBe('authored')
    expect(result.encrypted_data).toBe(BLOB)
    expect(await verifyRecord(result, signer)).toBe('authored')
  })
})

describe('revoke()', () => {
  it('signs the revoked state, including the time it sends, and keeps the origin', async () => {
    const reviewed = await storedRow({ origin: 'legacy-unverified' })
    mockedApi.post.mockImplementation(async (_url: string, body: Partial<Credential>) => {
      const row = { ...reviewed, ...body, is_active: false }
      mockedApi.get.mockResolvedValue({ data: row })
      return { data: row }
    })

    const result = await credentialService.revoke(reviewed)

    const [url, body, config] = mockedApi.post.mock.calls[0]
    expect(url).toBe(`/credentials/${ID}/revoke`)
    expect(config).toEqual({ headers: PROOF_HEADERS, assertOperation: expect.any(Function) })
    expect(body.revision).toBe(2)
    expect(body.origin).toBe('legacy-unverified')
    expect(typeof body.revoked_at).toBe('string')
    expect(await verifyRecord(result, signer)).toBe('legacy-unverified')
  })
})

describe('importBatch()', () => {
  it('stops later batches when the originating dialog closes during an upload', async () => {
    let release!: (value: unknown) => void
    mockedApi.post.mockImplementation(() => new Promise((resolve) => { release = resolve }))
    const operation = captureOperation()
    const entries = Array.from({ length: 501 }, () => ({ id: crypto.randomUUID(), encrypted_data: BLOB }))
    const result = expect(credentialService.importBatch(entries, 'legacy-unverified', operation.assertActive))
      .rejects.toBeInstanceOf(OperationCancelledError)
    await vi.waitFor(() => expect(mockedApi.post).toHaveBeenCalledTimes(1))
    operation.cancel()
    release({ data: { imported: 500, skipped: 0, errors: [] } })
    await result
    expect(mockedApi.post).toHaveBeenCalledTimes(1)
    expect(mockedApi.get).not.toHaveBeenCalled()
  })

  it('signs restored records as legacy-unverified: a backup cannot prove authorship', async () => {
    mockedApi.post.mockImplementation(async (_url, body) => {
      mockedApi.get.mockResolvedValue({ data: body.credentials })
      return { data: { imported: 1, skipped: 0, errors: [] } }
    })

    await credentialService.importBatch([{ id: ID, encrypted_data: BLOB, expires_at: null }])

    const [url, body, config] = mockedApi.post.mock.calls[0]
    expect(url).toBe('/credentials/import')
    expect(config).toEqual({ headers: PROOF_HEADERS, assertOperation: expect.any(Function) })
    const [sent] = body.credentials
    expect(sent.origin).toBe('legacy-unverified')
    expect(sent.revision).toBe(1)
    expect(await verifyRecord(
      { ...sent, is_active: true, revoked_at: null, expires_at: null },
      signer
    )).toBe('legacy-unverified')
  })
})

describe('listAll()', () => {
  it('reads every page, including revoked records', async () => {
    const page = (count: number, start: number) => ({ data: Array.from({ length: count }, (_, i) => ({ id: `${start + i}` })) })
    mockedApi.get.mockResolvedValueOnce(page(500, 0)).mockResolvedValueOnce(page(3, 500))

    const records = await credentialService.listAll()

    expect(records).toHaveLength(503)
    expect(mockedApi.get).toHaveBeenCalledTimes(2)
    expect(mockedApi.get.mock.calls[1][1].params).toEqual({
      include_revoked: true,
      skip: 500,
      limit: 500,
    })
  })
})
