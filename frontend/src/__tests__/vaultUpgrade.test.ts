/**
 * Key bundle and the one-time upgrade of an RSA-only vault. Keys are synthetic;
 * RSA-only blobs are built with the helpers that produced them before bundles.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/services/api', () => ({
  default: {
    post: vi.fn(),
  },
}))

import api from '@/services/api'
import {
  arrayBufferToBase64,
  base64ToArrayBuffer,
  createVaultUpgradeKeys,
  decryptCredential,
  deriveKEK,
  encryptCredential,
  exportEncryptedPrivateKey,
  exportPublicKey,
  generateKeyPair,
  generateSalt,
  rewrapPrivateKey,
  setupVault,
  unlockVault,
  VaultKeyMismatchError,
} from '@/lib/crypto'
import { signRecord, verifyRecord, type StoredRecord } from '@/lib/recordSigning'
import { VAULT_PROOF_HEADER, VAULT_PROOF_OAEP_LABEL } from '@/lib/vaultProof'
import {
  hasSeenAnySignedVault,
  hasSeenSignedVault,
  performVaultUpgrade,
  rememberSignedVault,
  VaultRollbackError,
} from '@/lib/vaultUpgrade'

const mockedPost = (api as unknown as { post: ReturnType<typeof vi.fn> }).post

const PASSWORD = 'synthetic-vault-password'
const CRED_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const CRED_DATA = { name: 'Synthetic', fields: { password: 'synthetic-value' } }

async function legacyVault() {
  const pair = await generateKeyPair()
  const salt = generateSalt()
  const kek = await deriveKEK(PASSWORD, salt)
  return {
    pair,
    saltBase64: arrayBufferToBase64(salt),
    encryptedPrivateKeyBase64: await exportEncryptedPrivateKey(pair.privateKey, kek),
    publicKeyBase64: await exportPublicKey(pair.publicKey),
  }
}

describe('key bundle', () => {
  it('a new vault is signed from the start and its keys cannot be exported', async () => {
    const vault = await setupVault(PASSWORD)

    expect(vault.signer.signingKey.extractable).toBe(false)
    expect(vault.privateKey.extractable).toBe(false)
    expect(atob(vault.encryptedPrivateKeyBase64).slice(0, 4)).toBe('CVKB')

    const unlocked = await unlockVault(
      PASSWORD, vault.saltBase64, vault.encryptedPrivateKeyBase64, vault.publicKeyBase64
    )
    expect(unlocked.pendingUpgrade).toBeNull()
    expect(unlocked.signer?.signingKey.extractable).toBe(false)
    expect(unlocked.signer?.vaultId).toBe(vault.signer.vaultId)
    expect(unlocked.signer?.signerId).toBe(vault.signer.signerId)
  }, 30000)

  it('verifies signatures across unlocks, with the key from the bundle', async () => {
    const vault = await setupVault(PASSWORD)
    const state = {
      id: CRED_ID,
      revision: 1,
      encrypted_data: btoa('synthetic'),
      is_active: true,
      expires_at: null,
      revoked_at: null,
      origin: 'authored' as const,
    }
    const signed = await signRecord(state, vault.signer)

    const unlocked = await unlockVault(
      PASSWORD, vault.saltBase64, vault.encryptedPrivateKeyBase64, vault.publicKeyBase64
    )
    expect(await verifyRecord({ ...state, ...signed }, unlocked.signer!)).toBe('authored')
  }, 30000)

  it('rejects a wrong password as a GCM failure, not as a key mismatch', async () => {
    const vault = await setupVault(PASSWORD)
    const attempt = unlockVault(
      'wrong-password-value', vault.saltBase64, vault.encryptedPrivateKeyBase64, vault.publicKeyBase64
    )
    await expect(attempt).rejects.toThrow()
    await expect(attempt).rejects.not.toBeInstanceOf(VaultKeyMismatchError)
  }, 30000)

  it('rejects a bundle with any byte changed, including its version', async () => {
    const vault = await setupVault(PASSWORD)
    const original = new Uint8Array(base64ToArrayBuffer(vault.encryptedPrivateKeyBase64))
    const unlock = (blob: Uint8Array) => unlockVault(
      PASSWORD, vault.saltBase64, arrayBufferToBase64(blob), vault.publicKeyBase64
    )

    const flipped = original.slice()
    flipped[flipped.length - 1] ^= 1
    await expect(unlock(flipped)).rejects.toThrow()

    const otherVersion = original.slice()
    otherVersion[4] = 2
    await expect(unlock(otherVersion)).rejects.toThrow('Unsupported vault key bundle version')
  }, 30000)

  it('reports a substituted RSA public key as a key mismatch', async () => {
    const vault = await setupVault(PASSWORD)
    const other = await generateKeyPair()
    await expect(unlockVault(
      PASSWORD, vault.saltBase64, vault.encryptedPrivateKeyBase64,
      await exportPublicKey(other.publicKey)
    )).rejects.toBeInstanceOf(VaultKeyMismatchError)
  }, 30000)

  it('password change keeps the same keys, so stored signatures stay valid', async () => {
    const vault = await setupVault(PASSWORD)
    const rewrapped = await rewrapPrivateKey(
      PASSWORD, 'another-synthetic-password', vault.saltBase64, vault.encryptedPrivateKeyBase64
    )

    const unlocked = await unlockVault(
      'another-synthetic-password', rewrapped.saltBase64,
      rewrapped.encryptedPrivateKeyBase64, vault.publicKeyBase64
    )
    expect(unlocked.signer?.signerId).toBe(vault.signer.signerId)
    expect(unlocked.signer?.vaultId).toBe(vault.signer.vaultId)
    await expect(unlockVault(
      PASSWORD, rewrapped.saltBase64, rewrapped.encryptedPrivateKeyBase64, vault.publicKeyBase64
    )).rejects.toThrow()
  }, 30000)

  it('password change refuses an RSA-only blob: unlocking upgrades such a vault first', async () => {
    const legacy = await legacyVault()
    await expect(rewrapPrivateKey(
      PASSWORD, 'another-synthetic-password', legacy.saltBase64, legacy.encryptedPrivateKeyBase64
    )).rejects.toBeInstanceOf(VaultKeyMismatchError)
  }, 30000)
})

describe('RSA-only vaults', () => {
  it('unlock without a signer and report that an upgrade is pending', async () => {
    const legacy = await legacyVault()
    const unlocked = await unlockVault(
      PASSWORD, legacy.saltBase64, legacy.encryptedPrivateKeyBase64, legacy.publicKeyBase64
    )
    expect(unlocked.signer).toBeNull()
    expect(unlocked.pendingUpgrade).not.toBeNull()
    expect(unlocked.privateKey.extractable).toBe(false)
  }, 30000)

  it('still refuse a substituted public key', async () => {
    const legacy = await legacyVault()
    const other = await generateKeyPair()
    await expect(unlockVault(
      PASSWORD, legacy.saltBase64, legacy.encryptedPrivateKeyBase64,
      await exportPublicKey(other.publicKey)
    )).rejects.toBeInstanceOf(VaultKeyMismatchError)
  }, 30000)

  it('upgrade to a bundle holding the same RSA key, so old credentials stay readable', async () => {
    const legacy = await legacyVault()
    const blob = await encryptCredential(CRED_DATA, legacy.pair.publicKey, CRED_ID)
    const unlocked = await unlockVault(
      PASSWORD, legacy.saltBase64, legacy.encryptedPrivateKeyBase64, legacy.publicKeyBase64
    )

    const keys = await createVaultUpgradeKeys(unlocked.pendingUpgrade!)
    const upgraded = await unlockVault(
      PASSWORD, legacy.saltBase64, keys.encryptedPrivateKeyBase64, legacy.publicKeyBase64
    )

    expect(upgraded.pendingUpgrade).toBeNull()
    expect(upgraded.signer?.signerId).toBe(keys.signer.signerId)
    expect(await decryptCredential(blob, upgraded.privateKey, CRED_ID)).toEqual(CRED_DATA)
  }, 30000)
})

describe('performVaultUpgrade', () => {
  const label = new TextEncoder().encode(VAULT_PROOF_OAEP_LABEL)

  beforeEach(() => {
    mockedPost.mockReset()
  })

  function legacyRow(overrides: Partial<StoredRecord> = {}): StoredRecord {
    return {
      id: CRED_ID,
      revision: 1,
      encrypted_data: btoa('legacy-ciphertext'),
      is_active: false,
      expires_at: '2027-01-01T00:00:00',
      revoked_at: '2026-06-01T00:00:00',
      origin: null,
      signature: null,
      signature_version: null,
      ...overrides,
    }
  }

  async function answerChallenge(publicKey: CryptoKey): Promise<void> {
    const secret = crypto.getRandomValues(new Uint8Array(32))
    const challenge = await crypto.subtle.encrypt({ name: 'RSA-OAEP', label }, publicKey, secret)
    mockedPost.mockImplementation(async (url: string) =>
      url === '/auth/vault/challenge'
        ? { data: { version: 1, challenge: arrayBufferToBase64(challenge), ticket: 'B'.repeat(32), expires_in: 300 } }
        : { data: { message: 'Vault upgraded' } }
    )
  }

  it('signs every record as legacy-unverified and sends it all at once with proof v1', async () => {
    const legacy = await legacyVault()
    await answerChallenge(legacy.pair.publicKey)
    const unlocked = await unlockVault(
      PASSWORD, legacy.saltBase64, legacy.encryptedPrivateKeyBase64, legacy.publicKeyBase64
    )
    const row = legacyRow()

    const signer = await performVaultUpgrade(unlocked, [row])

    const upgradeCall = mockedPost.mock.calls.find(([url]) => url === '/auth/vault/upgrade')!
    const [, body, config] = upgradeCall
    expect(config.headers[VAULT_PROOF_HEADER]).toBeTruthy()
    expect(atob(body.encrypted_private_key).slice(0, 4)).toBe('CVKB')
    expect(body.adoptions).toHaveLength(1)
    const [adoption] = body.adoptions
    expect(adoption.revision).toBe(2)
    expect(adoption.origin).toBe('legacy-unverified')
    expect(body).not.toHaveProperty('encrypted_data')

    // The signature covers the status the server reported, without claiming authorship.
    expect(await verifyRecord(
      { ...row, revision: 2, signature: adoption.signature, signature_version: 1, origin: adoption.origin },
      signer
    )).toBe('legacy-unverified')
  }, 30000)

  it('refuses when records already carry signatures: the keys must have been rolled back', async () => {
    const legacy = await legacyVault()
    const unlocked = await unlockVault(
      PASSWORD, legacy.saltBase64, legacy.encryptedPrivateKeyBase64, legacy.publicKeyBase64
    )

    await expect(performVaultUpgrade(unlocked, [
      legacyRow({ signature: 'A'.repeat(86) + '==', signature_version: 1, origin: 'authored' }),
    ])).rejects.toBeInstanceOf(VaultRollbackError)

    expect(mockedPost).not.toHaveBeenCalled()
  }, 30000)

  it('does not report success if the server refuses', async () => {
    const legacy = await legacyVault()
    await answerChallenge(legacy.pair.publicKey)
    const answer = mockedPost.getMockImplementation() as (url: string) => Promise<unknown>
    mockedPost.mockImplementation(async (url: string) => {
      if (url === '/auth/vault/upgrade') throw new Error('409')
      return answer(url)
    })
    const unlocked = await unlockVault(
      PASSWORD, legacy.saltBase64, legacy.encryptedPrivateKeyBase64, legacy.publicKeyBase64
    )

    await expect(performVaultUpgrade(unlocked, [legacyRow()])).rejects.toThrow('409')
  }, 30000)
})

describe('signed vault marker', () => {
  it('is keyed on the key derived from the vault, and starts unset', async () => {
    localStorage.clear()
    expect(await hasSeenSignedVault('public-key-a')).toBe(false)
    expect(hasSeenAnySignedVault()).toBe(false)

    await rememberSignedVault('public-key-a')

    expect(await hasSeenSignedVault('public-key-a')).toBe(true)
    expect(await hasSeenSignedVault('public-key-b')).toBe(false)
    expect(hasSeenAnySignedVault()).toBe(true)
    localStorage.clear()
  })

  it('stores no key material', async () => {
    localStorage.clear()
    await rememberSignedVault('public-key-a')
    expect(JSON.stringify(localStorage)).not.toContain('public-key-a')
    localStorage.clear()
  })
})
