import api from './api'
import type { CredentialHealthSummary } from '@/types'

export const healthService = {
  async getHealthSummary(): Promise<CredentialHealthSummary> {
    const response = await api.get<CredentialHealthSummary>('/credential-health/')
    return response.data
  },
}
