import api from './api'
import type { WebAuthnCredentialInfo } from '@/types'

export const webauthnService = {
  async getRegistrationOptions(deviceName: string = 'Security Key') {
    const response = await api.post('/webauthn/register/options', {
      device_name: deviceName,
    })
    return response.data
  },

  async completeRegistration(data: {
    device_name: string
    credential_id: string
    public_key: string
    attestation_object: string
    client_data_json: string
    transports: string[]
  }) {
    const response = await api.post('/webauthn/register/complete', data)
    return response.data
  },

  async getAuthenticationOptions() {
    const response = await api.post('/webauthn/authenticate/options')
    return response.data
  },

  async listCredentials(): Promise<WebAuthnCredentialInfo[]> {
    const response = await api.get<WebAuthnCredentialInfo[]>('/webauthn/credentials')
    return response.data
  },

  async deleteCredential(credentialId: string): Promise<void> {
    await api.delete(`/webauthn/credentials/${credentialId}`)
  },
}
