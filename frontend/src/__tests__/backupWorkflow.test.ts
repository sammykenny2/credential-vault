import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('@/services/credentialService', () => ({ credentialService: { listAll: vi.fn(), importBatch: vi.fn() } }))

import { credentialService } from '@/services/credentialService'
import * as backup from '@/lib/credentialBackup'
import { createCompleteBackup, restoreCompleteBackup } from '@/lib/backupWorkflow'
import { setupVault, encryptCredential, type VaultKeys } from '@/lib/crypto'
import { signRecord, type SignedRecordState } from '@/lib/recordSigning'
import { captureOperation, OperationCancelledError } from '@/lib/operationGuard'
import { useAuthStore } from '@/stores/authStore'
import { useVaultKeyStore } from '@/hooks/useVaultKey'
import type { CredentialListItem, User } from '@/types'

let vault: VaultKeys
let records: CredentialListItem[]
const password = 'synthetic-backup-password'
const user = { id: 'synthetic-owner' } as User

beforeAll(async () => {
  vault = await setupVault(password)
  records = await Promise.all(Array.from({ length: 102 }, async (_, index) => {
    const id = crypto.randomUUID()
    const state: SignedRecordState = {
      id, revision: 1, encrypted_data: await encryptCredential({ name: `Record ${index}`, fields: {} }, vault.publicKey, id),
      is_active: index !== 101, expires_at: null,
      revoked_at: index === 101 ? '2026-11-05T00:00:00.000Z' : null, origin: 'authored',
    }
    return { ...state, ...await signRecord(state, vault.signer),
      created_at: '2026-11-05T00:00:00Z', updated_at: '2026-11-05T00:00:00Z' }
  }))
}, 30000)

beforeEach(() => {
  vi.resetAllMocks()
  useAuthStore.getState().setUser(user)
  useVaultKeyStore.getState().setKeys(vault.privateKey, vault.publicKey, vault.publicKeyBase64, vault.signer)
  vi.mocked(credentialService.listAll).mockResolvedValue(records)
})
afterEach(() => { vi.restoreAllMocks(); useAuthStore.getState().logout() })

describe('complete backups', () => {
  it('includes more than the default page and preserves revoked status', async () => {
    const file = await createCompleteBackup(password, captureOperation())
    const payload = await backup.decryptBackup(file, password)
    expect(file.type).toBe('credential-record-backup')
    expect(payload.credentials).toHaveLength(102)
    expect(payload.credentials[101]).toMatchObject({ is_active: false, revoked_at: '2026-11-05T00:00:00.000Z' })
  }, 30000)

  it('rejects an incomplete backup when one record fails verification', async () => {
    vi.mocked(credentialService.listAll).mockResolvedValue([{ ...records[0], signature: null }])
    await expect(createCompleteBackup(password, captureOperation())).rejects.toThrow()
  })

  it('detects changes during export rather than marking a partial snapshot complete', async () => {
    vi.mocked(credentialService.listAll).mockResolvedValueOnce(records).mockResolvedValueOnce(records.slice(1))
    await expect(createCompleteBackup(password, captureOperation())).rejects.toThrow('vault changed')
  }, 30000)

  it('does not encrypt or upload an old restore after another account unlocks', async () => {
    let resolve!: (value: backup.CredentialBackupPayload) => void
    vi.spyOn(backup, 'decryptBackup').mockReturnValue(new Promise((done) => { resolve = done }))
    const restored = expect(restoreCompleteBackup({} as backup.CredentialBackupFile, password, captureOperation(), vi.fn()))
      .rejects.toBeInstanceOf(OperationCancelledError)
    useAuthStore.getState().logout()
    useAuthStore.getState().setUser({ ...user, id: 'different-owner' })
    useVaultKeyStore.getState().setKeys(vault.privateKey, vault.publicKey, vault.publicKeyBase64, vault.signer)
    resolve({ credentials: [{ data: { name: 'Old account plaintext', fields: {} }, expires_at: null, created_at: '2026-11-05T00:00:00Z' }] })
    await restored
    expect(credentialService.importBatch).not.toHaveBeenCalled()
  })

  it('keeps restored revoked records inactive and does not claim source authorship', async () => {
    const file = await createCompleteBackup(password, captureOperation())
    vi.mocked(credentialService.importBatch).mockResolvedValue({ imported: 102, skipped: 0, errors: [] })
    await restoreCompleteBackup(file, password, captureOperation(), vi.fn())
    const entries = vi.mocked(credentialService.importBatch).mock.calls[0][0]
    expect(entries[101]).toMatchObject({ is_active: false, revoked_at: '2026-11-05T00:00:00.000Z' })
    expect(vi.mocked(credentialService.importBatch).mock.calls[0].slice(1)).toEqual(['legacy-unverified', expect.any(Function)])
  }, 30000)
})
