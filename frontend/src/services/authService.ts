import api from './api'
import type { TokenResponse, GoogleOAuthCallback, User, VaultSetupRequest } from '@/types'

export const authService = {
  async getGoogleAuthUrl(redirectUri: string): Promise<string> {
    const response = await api.get<{ authorization_url: string }>('/oauth/google/authorize', {
      params: { redirect_uri: redirectUri },
    })
    return response.data.authorization_url
  },

  async googleCallback(data: GoogleOAuthCallback): Promise<TokenResponse> {
    const response = await api.post<TokenResponse>('/oauth/google/callback', data)
    return response.data
  },

  async login(email: string, password: string): Promise<TokenResponse> {
    const response = await api.post<TokenResponse>('/auth/login', { email, password })
    return response.data
  },

  async getMe(): Promise<User> {
    const response = await api.get<User>('/users/me')
    return response.data
  },

  async setupVault(data: VaultSetupRequest): Promise<void> {
    await api.post('/auth/vault/setup', data)
  },

  async verifyPassword(password: string): Promise<{ verified: boolean }> {
    const response = await api.post<{ verified: boolean }>('/auth/verify-password', { password })
    return response.data
  },

  async linkGoogleAccount(data: GoogleOAuthCallback): Promise<User> {
    const response = await api.post<User>('/users/me/link-google', data)
    return response.data
  },
}
