import api from './api'
import axios from 'axios'
import { useAuthStore } from '@/stores/authStore'
import { captureOperation, OperationCancelledError, type OperationCheck } from '@/lib/operationGuard'
import type {
  TokenResponse,
  GoogleOAuthCallback,
  User,
  VaultSetupRequest,
  VaultRekeyRequest,
} from '@/types'

export const authService = {
  async acceptSession(data: TokenResponse): Promise<void> {
    useAuthStore.getState().setAccessToken(data.access_token)
    const operation = captureOperation(false)
    const user = await authService.getMe()
    operation.assertActive()
    if (user.id !== data.user_id) throw new OperationCancelledError()
    useAuthStore.getState().setUser(user)
    useAuthStore.getState().setVaultSetupToken(data.vault_setup_token ?? null)
  },
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
    const token = useAuthStore.getState().accessToken
    useAuthStore.getState().logout()
    await axios.post(`${api.defaults.baseURL}/auth/logout`, null, {
      headers: { Authorization: `Bearer ${token}` }, withCredentials: true,
      timeout: 30_000,
    })
  },

  async getMe(): Promise<User> {
    const response = await api.get<User>('/users/me')
    return response.data
  },

  async setupVault(data: VaultSetupRequest, assertOperation?: OperationCheck): Promise<void> {
    const token = useAuthStore.getState().vaultSetupToken
    if (!token) throw new Error('vault_setup_authorization_required')
    await api.post('/auth/vault/setup', data, { headers: { 'X-Vault-Setup': token }, assertOperation })
    useAuthStore.getState().setVaultSetupToken(null)
  },

  /** Store a re-wrapped private key; `headers` must carry the vault proof. */
  async rekeyVault(data: VaultRekeyRequest, headers: Record<string, string>, assertOperation?: OperationCheck): Promise<void> {
    await api.put('/auth/vault/keys', data, { headers, assertOperation })
  },

  async verifyPassword(password: string, assertOperation?: OperationCheck): Promise<{ verified: boolean; link_token: string }> {
    const response = await api.post<{ verified: boolean; link_token: string }>('/auth/verify-password', { password }, { assertOperation })
    return response.data
  },

  /** Add a password to an admin account; `headers` must carry the vault proof. */
  async setPassword(password: string, headers: Record<string, string>, assertOperation?: OperationCheck): Promise<User> {
    const response = await api.put<User>('/users/me/password', { password }, { headers, assertOperation })
    return response.data
  },

  async linkGoogleAccount(data: GoogleOAuthCallback & { link_token: string }): Promise<User> {
    const response = await api.post<User>('/users/me/link-google', data)
    return response.data
  },
}
