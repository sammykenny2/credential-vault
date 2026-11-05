import api from './api'
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
  signer: VaultSigner
): Promise<Credential> {
  const { data } = await api.get<Credential>(`/credentials/${state.id}`)
  assertRequestedRecord(data, state.id)
  if (
    data.encrypted_data !== state.encrypted_data ||
    data.revision !== state.revision ||
    data.signature !== signed.signature
  ) {
    throw new Error('Storage integrity check failed: the re-read record does not match what was signed.')
  }
  await verifyRecord(data, signer)
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
    headers: Record<string, string>
  ) => Promise<unknown>
): Promise<Credential> {
  const signer = requireSigner()
  const state = derive(await verifyRecord(reviewed, signer))
  const signed = await signRecord(state, signer)
  await send(state, signed, await vaultProofHeaders())
  return readBackAndVerify(state, signed, signer)
}

export const credentialService = {
  async list(includeRevoked = false): Promise<CredentialListItem[]> {
    const response = await api.get<CredentialListItem[]>('/credentials/', {
      params: { include_revoked: includeRevoked },
    })
    return response.data
  },

  /** Every record, including revoked ones, across all pages. */
  async listAll(): Promise<CredentialListItem[]> {
    const records: CredentialListItem[] = []
    for (;;) {
      const { data } = await api.get<CredentialListItem[]>('/credentials/', {
        params: { include_revoked: true, skip: records.length, limit: LIST_PAGE_SIZE },
      })
      records.push(...data)
      if (data.length < LIST_PAGE_SIZE) return records
      if (records.length > MAX_LISTED_RECORDS) throw new Error('Too many credentials to list.')
    }
  },

  async get(id: string): Promise<Credential> {
    const { data } = await api.get<Credential>(`/credentials/${id}`)
    assertRequestedRecord(data, id)
    return data
  },

  async create(data: CredentialCreate): Promise<Credential> {
    const signer = requireSigner()
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
    const headers = await vaultProofHeaders()
    await api.post<Credential>(
      '/credentials/',
      {
        id: state.id,
        encrypted_data: state.encrypted_data,
        expires_at: state.expires_at,
        ...signedFields(state, signed),
      },
      { headers }
    )

    try {
      return await readBackAndVerify(state, signed, signer)
    } catch (err) {
      // A brand-new record has nothing to lose: remove it rather than leave a bad copy.
      await api.delete(`/credentials/${state.id}`, { headers })
      if (err instanceof Error && err.message.startsWith('Storage integrity check failed')) {
        throw new Error(`${err.message} The credential was not saved.`, { cause: err })
      }
      throw err
    }
  },

  /**
   * The user has read a legacy-unverified record and accepts it as theirs. Only ever
   * called from an explicit action, with the record they read, never in the background.
   */
  async confirmOrigin(reviewed: Credential): Promise<Credential> {
    return writeNextState(
      reviewed,
      () => ({ ...reviewed, revision: reviewed.revision + 1, origin: 'authored' }),
      (state, signed, headers) => api.patch(
        `/credentials/${reviewed.id}`,
        signedFields(state, signed),
        { headers }
      )
    )
  },

  async revoke(reviewed: Credential): Promise<Credential> {
    return writeNextState(
      reviewed,
      (origin) => ({
        ...reviewed,
        revision: reviewed.revision + 1,
        is_active: false,
        revoked_at: new Date().toISOString(),
        origin,
      }),
      (state, signed, headers) => api.post(
        `/credentials/${reviewed.id}/revoke`,
        { revoked_at: state.revoked_at, ...signedFields(state, signed) },
        { headers }
      )
    )
  },

  async delete(id: string): Promise<void> {
    await api.delete(`/credentials/${id}`, { headers: await vaultProofHeaders() })
  },

  /**
   * Restored records come from a backup format that carries no signature, so they
   * are labelled legacy-unverified: re-signing them here says nothing about who
   * wrote them.
   */
  async importBatch(
    credentials: Array<{ id: string; encrypted_data: string; expires_at?: string | null }>,
    origin: RecordOrigin = 'legacy-unverified'
  ): Promise<{ imported: number; skipped: number; errors: string[] }> {
    const signer = requireSigner()
    const signedCredentials = await Promise.all(credentials.map(async (credential) => {
      const state: SignedRecordState = {
        id: credential.id,
        revision: 1,
        encrypted_data: credential.encrypted_data,
        is_active: true,
        expires_at: toIsoTimestamp(credential.expires_at),
        revoked_at: null,
        origin,
      }
      return {
        id: state.id,
        encrypted_data: state.encrypted_data,
        expires_at: state.expires_at,
        ...signedFields(state, await signRecord(state, signer)),
      }
    }))
    const response = await api.post<{ imported: number; skipped: number; errors: string[] }>(
      '/credentials/import',
      { credentials: signedCredentials, format: 'json' },
      { headers: await vaultProofHeaders() }
    )
    return response.data
  },

  async deleteAll(ids: string[]): Promise<void> {
    const headers = await vaultProofHeaders()
    await Promise.all(ids.map((id) => api.delete(`/credentials/${id}`, { headers })))
  },
}

export type { StoredRecord }
