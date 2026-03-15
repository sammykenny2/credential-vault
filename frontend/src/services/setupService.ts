import api from './api'
import type { TokenResponse } from '@/types'

export interface SetupStatus {
  is_initialized: boolean
}

export const setupService = {
  async getStatus(): Promise<SetupStatus> {
    const response = await api.get<SetupStatus>('/setup/status')
    return response.data
  },

  async createAdmin(
    email: string,
    password: string,
    displayName?: string
  ): Promise<TokenResponse> {
    const response = await api.post<TokenResponse>('/setup/admin', {
      email,
      password,
      display_name: displayName || undefined,
    })
    return response.data
  },
}
