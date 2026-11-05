import { describe, expect, it } from 'vitest'
import { encryptBackup, decryptBackup, generateBackupPassword } from '@/lib/credentialBackup'
import { deriveKEK, generateSalt, arrayBufferToBase64 } from '@/lib/crypto'
import { MIN_BACKUP_PASSWORD_LENGTH } from '@/lib/passwordPolicy'

const entries = [{ data: { name: 'Synthetic backup', fields: { password: 'synthetic-value' } },
  expires_at: null, created_at: '2026-11-05T00:00:00Z',
  is_active: false, revoked_at: '2026-11-05T00:00:00Z', source_origin: 'authored' as const }]

describe('credential backup password policy', () => {
  it('provides a strong generated recovery password', () => {
    expect(generateBackupPassword()).toMatch(/^[A-Za-z0-9]{32}$/)
  })
  it.each(['12345678', '12345678901'])('rejects a short password before exporting', async (password) => {
    await expect(encryptBackup(entries, password)).rejects.toThrow('at least 12 characters')
  })

  it('creates a restorable backup with a twelve-character password', async () => {
    expect(MIN_BACKUP_PASSWORD_LENGTH).toBe(12)
    const file = await encryptBackup(entries, 'synthetic-12')
    expect(await decryptBackup(file, 'synthetic-12')).toEqual({ credentials: entries })
  })

  it('still reads existing v1 backups protected by shorter passwords', async () => {
    const salt = generateSalt()
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const key = await deriveKEK('old-pass', salt)
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv }, key,
      new TextEncoder().encode(JSON.stringify({ credentials: entries }))
    )
    const oldFile = { type: 'credential-backup' as const, version: 1 as const,
      exportedAt: '2026-11-05T00:00:00Z', credentialCount: 1,
      salt: arrayBufferToBase64(salt), iv: arrayBufferToBase64(iv),
      encryptedData: arrayBufferToBase64(ciphertext) }
    expect(await decryptBackup(oldFile, 'old-pass')).toEqual({ credentials: entries })
  })
})
