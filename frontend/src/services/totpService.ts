import api from './api'
import type { TOTPAccount, TOTPAccountCreate, TOTPCodeResponse } from '@/types'

export const totpService = {
  async listAccounts(): Promise<TOTPAccount[]> {
    const response = await api.get<TOTPAccount[]>('/totp/')
    return response.data
  },

  async createAccount(data: TOTPAccountCreate): Promise<TOTPAccount> {
    const response = await api.post<TOTPAccount>('/totp/', data)
    return response.data
  },

  async getAccount(accountId: string): Promise<TOTPAccount> {
    const response = await api.get<TOTPAccount>(`/totp/${accountId}`)
    return response.data
  },

  async generateCode(accountId: string): Promise<TOTPCodeResponse> {
    const response = await api.post<TOTPCodeResponse>(`/totp/${accountId}/code`)
    return response.data
  },

  async updateAccount(accountId: string, data: Partial<TOTPAccountCreate>): Promise<TOTPAccount> {
    const response = await api.patch<TOTPAccount>(`/totp/${accountId}`, data)
    return response.data
  },

  async deleteAccount(accountId: string): Promise<void> {
    await api.delete(`/totp/${accountId}`)
  },
}
