import api from './api'
import { captureOperation, type OperationCheck } from '@/lib/operationGuard'
import { useVaultKeyStore } from '@/hooks/useVaultKey'
import type { VaultSigner } from '@/lib/crypto'
import {
  RecordVerificationError,
  signRecord,
  verifyRecord,
  type RecordOrigin,
  type RecordSignature,
  type SignedRecordState,
  type StoredRecord,
} from '@/lib/recordSigning'
import { VaultLockedError, vaultProofHeaders } from '@/lib/vaultProof'
import type { Credential, CredentialListItem, CredentialCreate } from '@/types'

/** The server's maximum page size for GET /credentials/. */
const LIST_PAGE_SIZE = 500
/** The upgrade endpoint's limit. Also stops a server that keeps sending full pages. */
const MAX_LISTED_RECORDS = 10_000

function requireSigner(): VaultSigner {
  useVaultKeyStore.getState().checkTimeout()
  const { signer } = useVaultKeyStore.getState()
  if (!signer) throw new VaultLockedError()
  return signer
}

function toIsoTimestamp(value: string | null | undefined): string | null {
  return value ? new Date(value).toISOString() : null
}

function signedFields(state: SignedRecordState, signed: RecordSignature) {
  return { revision: state.revision, ...signed }
}

/** A verified row proves a state was signed, not that it is the record that was asked for. */
function assertRequestedRecord(record: { id: string }, id: string): void {
  if (record.id !== id) throw new RecordVerificationError()
}

/**
 * Read the record back and check it is exactly what was just signed. Also catches a
 * dropped write, and a mismatch between how the browser and server represent a state.
 */
async function readBackAndVerify(
  state: SignedRecordState,
  signed: RecordSignature,
  signer: VaultSigner,
  assertActive: OperationCheck = () => {}
): Promise<Credential> {
  assertActive()
  const { data } = await api.get<Credential>(`/credentials/${state.id}`, { assertOperation: assertActive })
  assertActive()
  assertRequestedRecord(data, state.id)
  if (
    data.encrypted_data !== state.encrypted_data ||
    data.revision !== state.revision ||
    data.signature !== signed.signature
  ) {
    throw new Error('Storage integrity check failed: the re-read record does not match what was signed.')
  }
  await verifyRecord(data, signer)
  assertActive()
  return data
}

/**
 * Sign and store a new state derived from a record the user has seen.
 *
 * Deliberately no fresh GET here. A server answering that request could substitute
 * another validly signed record, and the browser would sign it as if the user had
 * chosen it. An honest server refuses a record that moved on since it was read (409).
 *
 * This does not stop replay. A malicious server can show an older validly signed
 * version of the record in the first place, and acting on it produces a new signature
 * for what the user saw. Only remembering the highest revision seen could catch that.
 *
 * There is no rollback on a failed re-read, because writing the old blob back could
 * overwrite a newer revision: the error is reported and the data stays as it is.
 */
async function writeNextState(
  reviewed: Credential,
  derive: (origin: RecordOrigin) => SignedRecordState,
  send: (
    state: SignedRecordState,
    signed: RecordSignature,
    headers: Record<string, string>,
    assertOperation: OperationCheck,
  ) => Promise<unknown>,
  assertActive?: OperationCheck,
): Promise<Credential> {
  const signer = requireSigner()
  const operation = captureOperation(true, assertActive)
  try {
    const state = derive(await verifyRecord(reviewed, signer))
    operation.assertActive()
    const signed = await signRecord(state, signer)
    operation.assertActive()
    const headers = await vaultProofHeaders()
    operation.assertActive()
    await send(state, signed, headers, operation.assertActive)
    return await readBackAndVerify(state, signed, signer, operation.assertActive)
  } finally { operation.cancel() }
}

export const credentialService = {
  async list(includeRevoked = false): Promise<CredentialListItem[]> {
    const response = await api.get<CredentialListItem[]>('/credentials/', {
      params: { include_revoked: includeRevoked },
    })
    return response.data
  },

  /** Every record, including revoked ones, across all pages. */
  async listAll(assertActive: OperationCheck = captureOperation(false).assertActive): Promise<CredentialListItem[]> {
    const records: CredentialListItem[] = []
    for (;;) {
      assertActive()
      const { data } = await api.get<CredentialListItem[]>('/credentials/', {
        params: { include_revoked: true, skip: records.length, limit: LIST_PAGE_SIZE },
        assertOperation: assertActive,
      })
      assertActive()
      records.push(...data)
      if (new Set(records.map((record) => record.id)).size !== records.length) {
        throw new Error('Credential listing changed or contains duplicate records. Please retry.')
      }
      if (records.length > MAX_LISTED_RECORDS) throw new Error('Too many credentials to list.')
      if (data.length < LIST_PAGE_SIZE) return records
    }
  },

  async get(id: string): Promise<Credential> {
    const { data } = await api.get<Credential>(`/credentials/${id}`)
    assertRequestedRecord(data, id)
    return data
  },

  async create(data: CredentialCreate, assertActive?: OperationCheck): Promise<Credential> {
    const signer = requireSigner()
    const operation = captureOperation(true, assertActive)
    try {
      const state: SignedRecordState = {
        id: data.id,
        revision: 1,
        encrypted_data: data.encrypted_data,
        is_active: true,
        expires_at: toIsoTimestamp(data.expires_at),
        revoked_at: null,
        origin: 'authored',
      }
      const signed = await signRecord(state, signer)
      operation.assertActive()
      const headers = await vaultProofHeaders()
      operation.assertActive()
      await api.post<Credential>(
        '/credentials/',
        {
          id: state.id,
          encrypted_data: state.encrypted_data,
          expires_at: state.expires_at,
          ...signedFields(state, signed),
        },
        { headers, assertOperation: operation.assertActive }
      )

      return await readBackAndVerify(state, signed, signer, operation.assertActive)
    } finally { operation.cancel() }
  },

  /**
   * The user has read a legacy-unverified record and accepts it as theirs. Only ever
   * called from an explicit action, with the record they read, never in the background.
   */
  async confirmOrigin(reviewed: Credential, assertActive?: OperationCheck): Promise<Credential> {
    return writeNextState(
      reviewed,
      () => ({ ...reviewed, revision: reviewed.revision + 1, origin: 'authored' }),
      (state, signed, headers, assertOperation) => api.patch(
        `/credentials/${reviewed.id}`,
        signedFields(state, signed),
        { headers, assertOperation }
      ), assertActive
    )
  },

  async revoke(reviewed: Credential, assertActive?: OperationCheck): Promise<Credential> {
    return writeNextState(
      reviewed,
      (origin) => ({
        ...reviewed,
        revision: reviewed.revision + 1,
        is_active: false,
        revoked_at: new Date().toISOString(),
        origin,
      }),
      (state, signed, headers, assertOperation) => api.post(
        `/credentials/${reviewed.id}/revoke`,
        { revoked_at: state.revoked_at, ...signedFields(state, signed) },
        { headers, assertOperation }
      ), assertActive
    )
  },

  async delete(id: string, assertActive?: OperationCheck): Promise<void> {
    const operation = captureOperation(true, assertActive)
    try {
      const headers = await vaultProofHeaders()
      operation.assertActive()
      await api.delete(`/credentials/${id}`, { headers, assertOperation: operation.assertActive })
      operation.assertActive()
    } finally { operation.cancel() }
  },

  /**
   * Restored records come from a backup format that carries no signature, so they
   * are labelled legacy-unverified: re-signing them here says nothing about who
   * wrote them.
   */
  async importBatch(
    credentials: Array<{ id: string; encrypted_data: string; expires_at?: string | null;
      is_active?: boolean; revoked_at?: string | null }>,
    origin: RecordOrigin = 'legacy-unverified',
    assertActive?: OperationCheck,
  ): Promise<{ imported: number; skipped: number; errors: string[] }> {
    const signer = requireSigner()
    const operation = captureOperation(true, assertActive)
    try {
      const signedCredentials = await Promise.all(credentials.map(async (credential) => {
        const state: SignedRecordState = {
          id: credential.id,
          revision: 1,
          encrypted_data: credential.encrypted_data,
          is_active: credential.is_active ?? true,
          expires_at: toIsoTimestamp(credential.expires_at),
          revoked_at: toIsoTimestamp(credential.revoked_at),
          origin,
        }
        return {
          id: state.id,
          encrypted_data: state.encrypted_data,
          expires_at: state.expires_at,
          is_active: state.is_active,
          revoked_at: state.revoked_at,
          ...signedFields(state, await signRecord(state, signer)),
        }
      }))
      operation.assertActive()
      // Preflight all batches before writing; stay below nginx's 1 MiB request cap.
      const batches: Array<typeof signedCredentials> = []
      let batch: typeof signedCredentials = []
      let bytes = 64
      for (const credential of signedCredentials) {
        const size = new TextEncoder().encode(JSON.stringify(credential)).length + 1
        if (size > 900_000) throw new Error('A credential exceeds the restore request limit.')
        if (batch.length >= 500 || bytes + size > 900_000) {
          batches.push(batch); batch = []; bytes = 64
        }
        batch.push(credential); bytes += size
      }
      if (batch.length) batches.push(batch)
      for (const chunk of batches) {
        const headers = await vaultProofHeaders()
        operation.assertActive()
        const { data } = await api.post<{ imported: number; skipped: number; errors: string[] }>(
          '/credentials/import', { credentials: chunk, format: 'json' },
          { headers, assertOperation: operation.assertActive }
        )
        operation.assertActive()
        if (data.imported !== chunk.length || data.skipped !== 0 || data.errors.length) {
          throw new Error('Restore did not finish. Some earlier batches may have been saved; inspect the vault before retrying.')
        }
      }
      const stored = new Map((await credentialService.listAll(operation.assertActive)).map((r) => [r.id, r]))
      for (const expected of signedCredentials) {
        operation.assertActive()
        const record = stored.get(expected.id)
        if (!record || record.encrypted_data !== expected.encrypted_data ||
            record.revision !== 1 || record.signature !== expected.signature) {
          throw new Error('Restore verification failed. Some records may have been saved; inspect the vault before retrying.')
        }
        await verifyRecord(record, signer)
      }
      operation.assertActive()
      return { imported: signedCredentials.length, skipped: 0, errors: [] }
    } finally { operation.cancel() }
  },

  async deleteAll(ids: string[]): Promise<void> {
    const operation = captureOperation()
    try {
      for (const id of ids) {
        operation.assertActive()
        await credentialService.delete(id, operation.assertActive)
      }
    } finally { operation.cancel() }
  },
}

export type { StoredRecord }
