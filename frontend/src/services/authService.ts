import api from './api'
import type {
  TokenResponse,
  GoogleOAuthCallback,
  User,
  VaultSetupRequest,
  VaultRekeyRequest,
} from '@/types'

export const authService = {
  /** `state` comes from beginOAuthFlow() and is checked again on the way back. */
  async getGoogleAuthUrl(redirectUri: string, state: string): Promise<string> {
    const response = await api.get<{ authorization_url: string }>('/oauth/google/authorize', {
      params: { redirect_uri: redirectUri, state },
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

  /** Revoke every session for this account and clear the refresh cookie. */
  async logout(): Promise<void> {
    try {
      await api.post('/auth/logout')
    } catch {
      // Already signed out server-side; local state is cleared by the caller.
    }
  },

  async getMe(): Promise<User> {
    const response = await api.get<User>('/users/me')
    return response.data
  },

  async setupVault(data: VaultSetupRequest): Promise<void> {
    await api.post('/auth/vault/setup', data)
  },

  /** Store a re-wrapped private key; `headers` must carry the vault proof. */
  async rekeyVault(data: VaultRekeyRequest, headers: Record<string, string>): Promise<void> {
    await api.put('/auth/vault/keys', data, { headers })
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
