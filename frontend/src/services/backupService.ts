import api from './api'
import type { BackupResponse, RestoreResult } from '@/types'

export const backupService = {
  async createBackup(
    password: string,
    options: {
      include_credentials?: boolean
      include_templates?: boolean
      include_totp_accounts?: boolean
    } = {}
  ): Promise<BackupResponse> {
    const response = await api.post<BackupResponse>('/backup/create', {
      encryption_password: password,
      include_credentials: options.include_credentials ?? true,
      include_templates: options.include_templates ?? true,
      include_totp_accounts: options.include_totp_accounts ?? true,
    })
    return response.data
  },

  async restoreBackup(
    encryptedData: string,
    password: string,
    overwriteExisting: boolean = false
  ): Promise<RestoreResult> {
    const response = await api.post<RestoreResult>('/backup/restore', {
      encrypted_data: encryptedData,
      encryption_password: password,
      overwrite_existing: overwriteExisting,
    })
    return response.data
  },

  downloadBackup(backupData: BackupResponse, filename?: string) {
    const blob = new Blob([JSON.stringify(backupData)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename || `vault-backup-${new Date().toISOString().split('T')[0]}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  },
}
