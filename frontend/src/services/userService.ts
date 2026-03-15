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

  async updateRole(id: string, role: UserRole): Promise<User> {
    const response = await api.patch<User>(`/users/${id}/role`, { role })
    return response.data
  },

  async update(id: string, data: Partial<{ display_name: string; is_active: boolean }>): Promise<User> {
    const response = await api.patch<User>(`/users/${id}`, data)
    return response.data
  },

  async deactivate(id: string): Promise<void> {
    await api.delete(`/users/${id}`)
  },
}
