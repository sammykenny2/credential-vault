import { credentialService } from '@/services/credentialService'
import { decryptCredential, encryptCredential } from './crypto'
import { verifyRecord, type StoredRecord } from './recordSigning'
import { encryptBackup, decryptBackup, type CredentialBackupFile, type CredentialBackupEntry } from './credentialBackup'
import type { VaultOperation } from './operationGuard'

function snapshot(records: StoredRecord[]): string {
  return JSON.stringify(records.map((r) => [r.id, r.revision, r.signature, r.encrypted_data,
    r.is_active, r.expires_at, r.revoked_at, r.origin]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))))
}

/** Re-fetch a complete list; never export the current screen's partial plaintext cache. */
export async function createCompleteBackup(password: string, operation: VaultOperation): Promise<CredentialBackupFile> {
  const { privateKey, signer } = operation.vault
  if (!privateKey || !signer) throw new Error('Unlock the vault before creating a backup.')
  const records = await credentialService.listAll(operation.assertActive)
  const entries: CredentialBackupEntry[] = []
  for (const record of records) {
    operation.assertActive()
    const origin = await verifyRecord(record, signer)
    operation.assertActive()
    const data = await decryptCredential(record.encrypted_data, privateKey, record.id)
    operation.assertActive()
    entries.push({ data, expires_at: record.expires_at, created_at: record.created_at,
      is_active: record.is_active, revoked_at: record.revoked_at, source_origin: origin })
  }
  const backup = await encryptBackup(entries, password)
  operation.assertActive()
  const current = await credentialService.listAll(operation.assertActive)
  if (snapshot(records) !== snapshot(current)) {
    throw new Error('The vault changed during backup. No file was downloaded; please retry.')
  }
  operation.assertActive()
  return backup
}

export async function restoreCompleteBackup(
  file: CredentialBackupFile, password: string, operation: VaultOperation,
  progress: (message: string) => void,
) {
  const publicKey = operation.vault.publicKey
  if (!publicKey) throw new Error('Unlock the vault before restoring.')
  const payload = await decryptBackup(file, password)
  operation.assertActive()
  const credentials = []
  for (const entry of payload.credentials) {
    operation.assertActive()
    const id = crypto.randomUUID()
    const encrypted_data = await encryptCredential(entry.data, publicKey, id)
    operation.assertActive()
    credentials.push({ id, encrypted_data, expires_at: entry.expires_at,
      is_active: file.type === 'credential-record-backup' ? entry.is_active : true,
      revoked_at: file.type === 'credential-record-backup' ? entry.revoked_at : null })
  }
  operation.assertActive()
  progress(`Uploading and verifying ${credentials.length} credential(s)...`)
  const result = await credentialService.importBatch(credentials, 'legacy-unverified', operation.assertActive)
  operation.assertActive()
  return result
}
