import api from './api'
import type { LoginRequest, TokenResponse, MFASetup, User } from '@/types'

export const authService = {
  async login(data: LoginRequest): Promise<TokenResponse> {
    const formData = new URLSearchParams()
    formData.append('username', data.username)
    formData.append('password', data.password)

    const response = await api.post<TokenResponse>('/auth/login', formData, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    })
    return response.data
  },

  async getMe(): Promise<User> {
    const response = await api.get<User>('/users/me')
    return response.data
  },

  async setupMFA(): Promise<MFASetup> {
    const response = await api.post<MFASetup>('/auth/mfa/setup')
    return response.data
  },

  async enableMFA(code: string, secret: string): Promise<void> {
    await api.post('/auth/mfa/enable', { code }, { params: { secret } })
  },

  async verifyMFA(code: string): Promise<void> {
    await api.post('/auth/mfa/verify', { code })
  },

  async disableMFA(code: string): Promise<void> {
    await api.post('/auth/mfa/disable', { code })
  },

  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    await api.post('/auth/password/change', {
      current_password: currentPassword,
      new_password: newPassword,
    })
  },
}
