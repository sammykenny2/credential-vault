import api from './api'
import { vaultProofHeaders } from '@/lib/vaultProof'
import type { Credential, CredentialListItem, CredentialCreate } from '@/types'

export const credentialService = {
  async list(includeRevoked = false): Promise<CredentialListItem[]> {
    const response = await api.get<CredentialListItem[]>('/credentials/', {
      params: { include_revoked: includeRevoked },
    })
    return response.data
  },

  async get(id: string): Promise<Credential> {
    const response = await api.get<Credential>(`/credentials/${id}`)
    return response.data
  },

  async create(data: CredentialCreate): Promise<Credential> {
    const response = await api.post<Credential>('/credentials/', data)
    const id = response.data.id

    // Independent re-read to verify persistence
    const verification = await api.get<Credential>(`/credentials/${id}`)
    if (verification.data.encrypted_data !== data.encrypted_data) {
      await api.delete(`/credentials/${id}`, { headers: await vaultProofHeaders() })
      throw new Error('Storage integrity check failed: re-read encrypted data does not match. The credential was not saved.')
    }

    return response.data
  },

  async update(id: string, data: Partial<CredentialCreate>): Promise<Credential> {
    if (data.encrypted_data) {
      // Overwriting ciphertext is destructive: prove the vault is unlocked first.
      const headers = await vaultProofHeaders()

      // Fetch current data before update (for rollback on mismatch)
      const previous = await api.get<Credential>(`/credentials/${id}`)
      const previousBlob = previous.data.encrypted_data

      const response = await api.patch<Credential>(`/credentials/${id}`, data, { headers })

      // Independent re-read to verify persistence
      const verification = await api.get<Credential>(`/credentials/${id}`)
      if (verification.data.encrypted_data !== data.encrypted_data) {
        // Rollback to previous data
        await api.patch(`/credentials/${id}`, { encrypted_data: previousBlob }, { headers })
        throw new Error('Storage integrity check failed: re-read encrypted data does not match after update. Rolled back to previous data.')
      }

      return response.data
    }

    const response = await api.patch<Credential>(`/credentials/${id}`, data)
    return response.data
  },

  async revoke(id: string): Promise<Credential> {
    const response = await api.post<Credential>(`/credentials/${id}/revoke`)
    return response.data
  },

  async delete(id: string): Promise<void> {
    await api.delete(`/credentials/${id}`, { headers: await vaultProofHeaders() })
  },

  async importBatch(
    credentials: Array<{ id?: string; encrypted_data: string; expires_at?: string | null }>
  ): Promise<{ imported: number; skipped: number; errors: string[] }> {
    const response = await api.post<{ imported: number; skipped: number; errors: string[] }>(
      '/credentials/import',
      { credentials, format: 'json' }
    )
    return response.data
  },

  async deleteAll(ids: string[]): Promise<void> {
    const headers = await vaultProofHeaders()
    await Promise.all(ids.map((id) => api.delete(`/credentials/${id}`, { headers })))
  },
}
