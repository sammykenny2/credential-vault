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
}
