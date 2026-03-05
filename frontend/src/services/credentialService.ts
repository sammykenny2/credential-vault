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
    const response = await api.post<Credential>('/credentials', data)
    return response.data
  },

  async update(id: string, data: Partial<CredentialCreate>): Promise<Credential> {
    const response = await api.patch<Credential>(`/credentials/${id}`, data)
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
