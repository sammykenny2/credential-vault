import api from './api'
import type {
  PasswordGenerateRequest,
  PasswordGenerateResponse,
  PassphraseGenerateRequest,
  PassphraseGenerateResponse,
  PasswordStrengthResult,
  BreachCheckResult,
} from '@/types'

export const toolsService = {
  async generatePassword(options: Partial<PasswordGenerateRequest> = {}): Promise<PasswordGenerateResponse> {
    const defaults: PasswordGenerateRequest = {
      length: 20,
      uppercase: true,
      lowercase: true,
      digits: true,
      symbols: true,
      exclude_ambiguous: false,
    }
    const response = await api.post<PasswordGenerateResponse>('/tools/generate-password', {
      ...defaults,
      ...options,
    })
    return response.data
  },

  async generatePassphrase(options: Partial<PassphraseGenerateRequest> = {}): Promise<PassphraseGenerateResponse> {
    const defaults: PassphraseGenerateRequest = {
      word_count: 5,
      separator: '-',
      capitalize: false,
      include_number: false,
    }
    const response = await api.post<PassphraseGenerateResponse>('/tools/generate-passphrase', {
      ...defaults,
      ...options,
    })
    return response.data
  },

  async checkStrength(password: string): Promise<PasswordStrengthResult> {
    const response = await api.post<PasswordStrengthResult>('/tools/check-strength', {
      password,
    })
    return response.data
  },

  async checkBreach(password: string): Promise<BreachCheckResult> {
    const response = await api.post<BreachCheckResult>('/tools/check-breach', {
      password,
    })
    return response.data
  },
}
