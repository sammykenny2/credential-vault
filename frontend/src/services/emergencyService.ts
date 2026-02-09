import api from './api'
import type { EmergencyAccessGrant } from '@/types'

export const emergencyService = {
  async createGrant(granteeEmail: string, waitTimeDays: number = 7) {
    const response = await api.post('/emergency-access/grant', {
      grantee_email: granteeEmail,
      wait_time_days: waitTimeDays,
    })
    return response.data
  },

  async listMyGrants(): Promise<EmergencyAccessGrant[]> {
    const response = await api.get<EmergencyAccessGrant[]>('/emergency-access/granted-by-me')
    return response.data
  },

  async listGrantedToMe(): Promise<EmergencyAccessGrant[]> {
    const response = await api.get<EmergencyAccessGrant[]>('/emergency-access/granted-to-me')
    return response.data
  },

  async initiateRecovery(grantId: string) {
    const response = await api.post(`/emergency-access/${grantId}/initiate-recovery`)
    return response.data
  },

  async approveRecovery(grantId: string, encryptedKey: string = '') {
    const response = await api.post(`/emergency-access/${grantId}/approve`, null, {
      params: { encrypted_key: encryptedKey },
    })
    return response.data
  },

  async rejectRecovery(grantId: string) {
    const response = await api.post(`/emergency-access/${grantId}/reject`)
    return response.data
  },

  async revokeGrant(grantId: string): Promise<void> {
    await api.delete(`/emergency-access/${grantId}`)
  },
}
