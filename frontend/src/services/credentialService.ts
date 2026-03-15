import api from './api'
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

    // Verify server stored the encrypted blob correctly
    if (response.data.encrypted_data !== data.encrypted_data) {
      await api.delete(`/credentials/${response.data.id}`)
      throw new Error('Storage integrity check failed: server returned different encrypted data. The credential was not saved.')
    }

    return response.data
  },

  async update(id: string, data: Partial<CredentialCreate>): Promise<Credential> {
    const response = await api.patch<Credential>(`/credentials/${id}`, data)

    // Verify server stored the encrypted blob correctly
    if (data.encrypted_data && response.data.encrypted_data !== data.encrypted_data) {
      throw new Error('Storage integrity check failed: server returned different encrypted data after update.')
    }

    return response.data
  },

  async revoke(id: string): Promise<Credential> {
    const response = await api.post<Credential>(`/credentials/${id}/revoke`)
    return response.data
  },

  async delete(id: string): Promise<void> {
    await api.delete(`/credentials/${id}`)
  },

  async importBatch(
    credentials: Array<{ encrypted_data: string; expires_at?: string | null }>
  ): Promise<{ imported: number; skipped: number; errors: string[] }> {
    const response = await api.post<{ imported: number; skipped: number; errors: string[] }>(
      '/credentials/import',
      { credentials, format: 'json' }
    )
    return response.data
  },

  async deleteAll(ids: string[]): Promise<void> {
    await Promise.all(ids.map((id) => api.delete(`/credentials/${id}`)))
  },
}
