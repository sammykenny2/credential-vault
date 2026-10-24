import api from './api'
import type { User, UserRole } from '@/types'

interface UserAdminRead extends User {
  credential_count: number
}

export const userService = {
  async list(): Promise<UserAdminRead[]> {
    const response = await api.get<UserAdminRead[]>('/users/')
    return response.data
  },

  async get(id: string): Promise<UserAdminRead> {
    const response = await api.get<UserAdminRead>(`/users/${id}`)
    return response.data
  },

  // Changes to accounts need proof of vault unlock: `headers` must carry it
  // (vaultProofHeaders()), so a stolen session token cannot change accounts.

  async updateRole(id: string, role: UserRole, headers: Record<string, string>): Promise<User> {
    const response = await api.patch<User>(`/users/${id}/role`, { role }, { headers })
    return response.data
  },

  async update(
    id: string,
    data: Partial<{ display_name: string; is_active: boolean }>,
    headers: Record<string, string>
  ): Promise<User> {
    const response = await api.patch<User>(`/users/${id}`, data, { headers })
    return response.data
  },

  async deactivate(id: string, headers: Record<string, string>): Promise<void> {
    await api.delete(`/users/${id}`, { headers })
  },
}
