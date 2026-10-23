/**
 * E2EE Crypto Tests
 *
 * Comprehensive tests for the client-side encryption/decryption layer.
 * Covers: utility functions, key derivation, RSA key management,
 * vault setup/unlock, and hybrid credential encryption.
 *
 * Run with: npm test
 */

import { describe, it, expect, beforeAll } from 'vitest'
import {
  generateSalt,
  arrayBufferToBase64,
  base64ToArrayBuffer,
  deriveKEK,
  generateKeyPair,
  exportPublicKey,
  importPublicKey,
  exportEncryptedPrivateKey,
  importEncryptedPrivateKey,
  setupVault,
  unlockVault,
  encryptCredential,
  decryptCredential,
  encryptCredentialLegacy,
  credentialBlobVersion,
  rewrapPrivateKey,
  generatePassword,
  sha256,
  KDF_VERSION,
} from '@/lib/crypto'
import type { CredentialData } from '@/lib/crypto'

// ── Test Data ───────────────────────────────────────────────────────────

const CRED_ID = '1e3a5c7b-9d2f-4e6a-8b0c-2d4f6a8c0e1b'

const SAMPLE_CREDENTIAL: CredentialData = {
  name: 'Test Account',
  description: 'A test credential',
  website_url: 'https://example.com',
  category: 'web',
  fields: {
    username: 'testuser',
    password: 's3cret!P@ssw0rd',
    email: 'test@example.com',
  },
  notes: 'Some notes here',
}

const MINIMAL_CREDENTIAL: CredentialData = {
  name: 'Minimal',
  fields: {},
}

const VAULT_PASSWORD = 'my-strong-vault-password-123!'

// ── Utility Functions ───────────────────────────────────────────────────

describe('Utility Functions', () => {
  describe('KDF_VERSION', () => {
    it('should be version 2 (Argon2id)', () => {
      expect(KDF_VERSION).toBe(2)
    })
  })

  describe('arrayBufferToBase64 / base64ToArrayBuffer', () => {
    it('should round-trip empty buffer', () => {
      const original = new Uint8Array([]).buffer
      const b64 = arrayBufferToBase64(original)
      const restored = base64ToArrayBuffer(b64)
      expect(new Uint8Array(restored)).toEqual(new Uint8Array(original))
    })

    it('should round-trip known bytes', () => {
      const original = new Uint8Array([72, 101, 108, 108, 111]).buffer // "Hello"
      const b64 = arrayBufferToBase64(original)
      expect(b64).toBe('SGVsbG8=')
      const restored = base64ToArrayBuffer(b64)
      expect(new Uint8Array(restored)).toEqual(new Uint8Array(original))
    })

    it('should round-trip binary data with all byte values', () => {
      const original = new Uint8Array(256)
      for (let i = 0; i < 256; i++) original[i] = i
      const b64 = arrayBufferToBase64(original.buffer)
      const restored = new Uint8Array(base64ToArrayBuffer(b64))
      expect(restored).toEqual(original)
    })

    it('should round-trip large buffer', () => {
      const original = crypto.getRandomValues(new Uint8Array(4096))
      const b64 = arrayBufferToBase64(original.buffer)
      const restored = new Uint8Array(base64ToArrayBuffer(b64))
      expect(restored).toEqual(original)
    })
  })

  describe('generateSalt', () => {
    it('should return 32 bytes', () => {
      const salt = generateSalt()
      expect(salt).toBeInstanceOf(Uint8Array)
      expect(salt.length).toBe(32)
    })

    it('should produce different values each time', () => {
      const salt1 = generateSalt()
      const salt2 = generateSalt()
      expect(arrayBufferToBase64(salt1.buffer)).not.toBe(
        arrayBufferToBase64(salt2.buffer)
      )
    })
  })

  describe('sha256', () => {
    it('should return 64-char hex string', async () => {
      const hash = await sha256('hello')
      expect(hash).toMatch(/^[0-9a-f]{64}$/)
    })

    it('should produce known hash for known input', async () => {
      // SHA-256("hello") = 2cf24dba...
      const hash = await sha256('hello')
      expect(hash).toBe(
        '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'
      )
    })

    it('should produce different hashes for different inputs', async () => {
      const h1 = await sha256('hello')
      const h2 = await sha256('world')
      expect(h1).not.toBe(h2)
    })

    it('should be deterministic', async () => {
      const h1 = await sha256('test-data')
      const h2 = await sha256('test-data')
      expect(h1).toBe(h2)
    })
  })

  describe('generatePassword', () => {
    it('should return requested length', () => {
      expect(generatePassword(8).length).toBe(8)
      expect(generatePassword(32).length).toBe(32)
      expect(generatePassword(64).length).toBe(64)
    })

    it('should default to 16 characters', () => {
      expect(generatePassword().length).toBe(16)
    })

    it('should produce different values each time', () => {
      const passwords = new Set(Array.from({ length: 10 }, () => generatePassword(32)))
      // With 32 chars, collision is astronomically unlikely
      expect(passwords.size).toBe(10)
    })

    it('should respect uppercase-only option', () => {
      const pw = generatePassword(100, {
        uppercase: true,
        lowercase: false,
        numbers: false,
        symbols: false,
      })
      expect(pw).toMatch(/^[A-Z]+$/)
    })

    it('should respect lowercase-only option', () => {
      const pw = generatePassword(100, {
        uppercase: false,
        lowercase: true,
        numbers: false,
        symbols: false,
      })
      expect(pw).toMatch(/^[a-z]+$/)
    })

    it('should respect numbers-only option', () => {
      const pw = generatePassword(100, {
        uppercase: false,
        lowercase: false,
        numbers: true,
        symbols: false,
      })
      expect(pw).toMatch(/^[0-9]+$/)
    })

    it('should fall back to lowercase if all options disabled', () => {
      const pw = generatePassword(100, {
        uppercase: false,
        lowercase: false,
        numbers: false,
        symbols: false,
      })
      expect(pw).toMatch(/^[a-z]+$/)
    })
  })
})

// ── Key Derivation ──────────────────────────────────────────────────────

describe('Key Derivation (Argon2id)', () => {
  it('should derive a CryptoKey from password and salt', async () => {
    const salt = generateSalt()
    const kek = await deriveKEK(VAULT_PASSWORD, salt)
    expect(kek).toBeDefined()
    expect(kek.type).toBe('secret')
    expect(kek.algorithm).toMatchObject({ name: 'AES-GCM' })
    expect(kek.usages).toContain('encrypt')
    expect(kek.usages).toContain('decrypt')
  }, 30000)

  it('should be deterministic (same password + salt = interchangeable key)', async () => {
    const salt = generateSalt()

    const kek1 = await deriveKEK(VAULT_PASSWORD, salt)
    const kek2 = await deriveKEK(VAULT_PASSWORD, salt)

    // Encrypt with kek1, decrypt with kek2
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const data = new TextEncoder().encode('test-data')
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      kek1,
      data
    )
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      kek2,
      encrypted
    )
    expect(new TextDecoder().decode(decrypted)).toBe('test-data')
  }, 30000)

  it('should produce different key for different password', async () => {
    const salt = generateSalt()

    const kek1 = await deriveKEK('password-A', salt)
    const kek2 = await deriveKEK('password-B', salt)

    // Encrypt with kek1, try decrypt with kek2 → should fail
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const data = new TextEncoder().encode('secret')
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      kek1,
      data
    )
    await expect(
      crypto.subtle.decrypt({ name: 'AES-GCM', iv }, kek2, encrypted)
    ).rejects.toThrow()
  }, 30000)

  it('should produce different key for different salt', async () => {
    const salt1 = generateSalt()
    const salt2 = generateSalt()

    const kek1 = await deriveKEK(VAULT_PASSWORD, salt1)
    const kek2 = await deriveKEK(VAULT_PASSWORD, salt2)

    const iv = crypto.getRandomValues(new Uint8Array(12))
    const data = new TextEncoder().encode('secret')
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      kek1,
      data
    )
    await expect(
      crypto.subtle.decrypt({ name: 'AES-GCM', iv }, kek2, encrypted)
    ).rejects.toThrow()
  }, 30000)
})

// ── RSA Key Pair Management ─────────────────────────────────────────────

describe('RSA Key Pair Management', () => {
  it('should generate a valid key pair', async () => {
    const keyPair = await generateKeyPair()
    expect(keyPair.publicKey).toBeDefined()
    expect(keyPair.privateKey).toBeDefined()
    expect(keyPair.publicKey.type).toBe('public')
    expect(keyPair.privateKey.type).toBe('private')
    expect(keyPair.publicKey.algorithm).toMatchObject({ name: 'RSA-OAEP' })
  })

  it('should export public key as base64 string', async () => {
    const keyPair = await generateKeyPair()
    const exported = await exportPublicKey(keyPair.publicKey)
    expect(typeof exported).toBe('string')
    expect(exported.length).toBeGreaterThan(0)
    // Base64 characters only
    expect(exported).toMatch(/^[A-Za-z0-9+/=]+$/)
  })

  it('should round-trip public key through export/import', async () => {
    const keyPair = await generateKeyPair()
    const exported = await exportPublicKey(keyPair.publicKey)
    const imported = await importPublicKey(exported)
    expect(imported.type).toBe('public')
    expect(imported.algorithm).toMatchObject({ name: 'RSA-OAEP' })

    // Verify imported key can encrypt (and original private key can decrypt)
    const data = new TextEncoder().encode('test')
    const encrypted = await crypto.subtle.encrypt(
      { name: 'RSA-OAEP' },
      imported,
      data
    )
    const decrypted = await crypto.subtle.decrypt(
      { name: 'RSA-OAEP' },
      keyPair.privateKey,
      encrypted
    )
    expect(new TextDecoder().decode(decrypted)).toBe('test')
  })

  it('should generate different key pairs each time', async () => {
    const kp1 = await generateKeyPair()
    const kp2 = await generateKeyPair()
    const exported1 = await exportPublicKey(kp1.publicKey)
    const exported2 = await exportPublicKey(kp2.publicKey)
    expect(exported1).not.toBe(exported2)
  })
})

// ── Private Key Encryption ──────────────────────────────────────────────

describe('Private Key Encryption', () => {
  it('should round-trip private key through encrypt/decrypt', async () => {
    const keyPair = await generateKeyPair()
    const salt = generateSalt()
    const kek = await deriveKEK(VAULT_PASSWORD, salt)

    const encryptedPK = await exportEncryptedPrivateKey(keyPair.privateKey, kek)
    expect(typeof encryptedPK).toBe('string')
    expect(encryptedPK.length).toBeGreaterThan(0)

    const restoredPK = await importEncryptedPrivateKey(encryptedPK, kek)
    expect(restoredPK.type).toBe('private')

    // Verify restored private key can decrypt data encrypted with original public key
    const data = new TextEncoder().encode('round-trip-test')
    const encrypted = await crypto.subtle.encrypt(
      { name: 'RSA-OAEP' },
      keyPair.publicKey,
      data
    )
    const decrypted = await crypto.subtle.decrypt(
      { name: 'RSA-OAEP' },
      restoredPK,
      encrypted
    )
    expect(new TextDecoder().decode(decrypted)).toBe('round-trip-test')
  }, 30000)

  it('should fail to decrypt with wrong KEK', async () => {
    const keyPair = await generateKeyPair()
    const salt1 = generateSalt()
    const salt2 = generateSalt()
    const kek1 = await deriveKEK('correct-password', salt1)
    const kek2 = await deriveKEK('wrong-password', salt2)

    const encryptedPK = await exportEncryptedPrivateKey(keyPair.privateKey, kek1)

    await expect(
      importEncryptedPrivateKey(encryptedPK, kek2)
    ).rejects.toThrow()
  }, 30000)

  it('should produce different ciphertext each time (randomized IV)', async () => {
    const keyPair = await generateKeyPair()
    const salt = generateSalt()
    const kek = await deriveKEK(VAULT_PASSWORD, salt)

    const enc1 = await exportEncryptedPrivateKey(keyPair.privateKey, kek)
    const enc2 = await exportEncryptedPrivateKey(keyPair.privateKey, kek)
    expect(enc1).not.toBe(enc2)
  }, 30000)
})

// ── Vault Setup & Unlock ────────────────────────────────────────────────

describe('Vault Setup & Unlock', () => {
  it('should return all required VaultKeys fields', async () => {
    const vault = await setupVault(VAULT_PASSWORD)

    expect(typeof vault.publicKeyBase64).toBe('string')
    expect(vault.publicKeyBase64.length).toBeGreaterThan(0)

    expect(typeof vault.encryptedPrivateKeyBase64).toBe('string')
    expect(vault.encryptedPrivateKeyBase64.length).toBeGreaterThan(0)

    expect(typeof vault.saltBase64).toBe('string')
    expect(vault.saltBase64.length).toBeGreaterThan(0)

    expect(vault.privateKey).toBeDefined()
    expect(vault.privateKey.type).toBe('private')

    expect(vault.publicKey).toBeDefined()
    expect(vault.publicKey.type).toBe('public')
  }, 30000)

  it('should unlock vault with correct password', async () => {
    const vault = await setupVault(VAULT_PASSWORD)

    const unlocked = await unlockVault(
      VAULT_PASSWORD,
      vault.saltBase64,
      vault.encryptedPrivateKeyBase64,
      vault.publicKeyBase64
    )

    expect(unlocked.privateKey).toBeDefined()
    expect(unlocked.privateKey.type).toBe('private')
    expect(unlocked.publicKey).toBeDefined()
    expect(unlocked.publicKey.type).toBe('public')
  }, 30000)

  it('should fail to unlock vault with wrong password', async () => {
    const vault = await setupVault(VAULT_PASSWORD)

    await expect(
      unlockVault(
        'wrong-password',
        vault.saltBase64,
        vault.encryptedPrivateKeyBase64,
        vault.publicKeyBase64
      )
    ).rejects.toThrow()
  }, 30000)

  it('should produce functional keys after unlock (encrypt/decrypt)', async () => {
    const vault = await setupVault(VAULT_PASSWORD)

    const unlocked = await unlockVault(
      VAULT_PASSWORD,
      vault.saltBase64,
      vault.encryptedPrivateKeyBase64,
      vault.publicKeyBase64
    )

    // Encrypt with unlocked public key, decrypt with unlocked private key
    const encrypted = await encryptCredential(SAMPLE_CREDENTIAL, unlocked.publicKey, CRED_ID)
    const decrypted = await decryptCredential(encrypted, unlocked.privateKey, CRED_ID)
    expect(decrypted).toEqual(SAMPLE_CREDENTIAL)
  }, 30000)
})

// ── Hybrid Credential Encryption ────────────────────────────────────────

describe('Hybrid Credential Encryption', () => {
  // Shared key pair for tests that don't need vault setup
  let publicKey: CryptoKey
  let privateKey: CryptoKey

  beforeAll(async () => {
    const keyPair = await generateKeyPair()
    publicKey = keyPair.publicKey
    privateKey = keyPair.privateKey
  })

  it('should encrypt to a base64 string', async () => {
    const encrypted = await encryptCredential(SAMPLE_CREDENTIAL, publicKey, CRED_ID)
    expect(typeof encrypted).toBe('string')
    expect(encrypted.length).toBeGreaterThan(0)
    expect(encrypted).toMatch(/^[A-Za-z0-9+/=]+$/)
  })

  it('should round-trip full credential data', async () => {
    const encrypted = await encryptCredential(SAMPLE_CREDENTIAL, publicKey, CRED_ID)
    const decrypted = await decryptCredential(encrypted, privateKey, CRED_ID)

    expect(decrypted.name).toBe(SAMPLE_CREDENTIAL.name)
    expect(decrypted.description).toBe(SAMPLE_CREDENTIAL.description)
    expect(decrypted.website_url).toBe(SAMPLE_CREDENTIAL.website_url)
    expect(decrypted.category).toBe(SAMPLE_CREDENTIAL.category)
    expect(decrypted.fields).toEqual(SAMPLE_CREDENTIAL.fields)
    expect(decrypted.notes).toBe(SAMPLE_CREDENTIAL.notes)
  })

  it('should round-trip minimal credential (name + empty fields)', async () => {
    const encrypted = await encryptCredential(MINIMAL_CREDENTIAL, publicKey, CRED_ID)
    const decrypted = await decryptCredential(encrypted, privateKey, CRED_ID)
    expect(decrypted.name).toBe('Minimal')
    expect(decrypted.fields).toEqual({})
  })

  it('should preserve unicode content', async () => {
    const credential: CredentialData = {
      name: '中文帳號 日本語 한국어',
      fields: {
        password: '密碼🔐emoji',
        note: 'Ñoño café résumé',
      },
    }
    const encrypted = await encryptCredential(credential, publicKey, CRED_ID)
    const decrypted = await decryptCredential(encrypted, privateKey, CRED_ID)
    expect(decrypted).toEqual(credential)
  })

  it('should handle large credential data', async () => {
    const credential: CredentialData = {
      name: 'Large Credential',
      fields: {
        key: 'A'.repeat(10000),
      },
      notes: 'B'.repeat(50000),
    }
    const encrypted = await encryptCredential(credential, publicKey, CRED_ID)
    const decrypted = await decryptCredential(encrypted, privateKey, CRED_ID)
    expect(decrypted).toEqual(credential)
  })

  it('should produce different ciphertexts for same data (randomized)', async () => {
    const enc1 = await encryptCredential(SAMPLE_CREDENTIAL, publicKey, CRED_ID)
    const enc2 = await encryptCredential(SAMPLE_CREDENTIAL, publicKey, CRED_ID)
    expect(enc1).not.toBe(enc2)

    // Both should decrypt to the same data
    const dec1 = await decryptCredential(enc1, privateKey, CRED_ID)
    const dec2 = await decryptCredential(enc2, privateKey, CRED_ID)
    expect(dec1).toEqual(dec2)
  })

  it('should fail to decrypt with wrong private key', async () => {
    const otherKeyPair = await generateKeyPair()
    const encrypted = await encryptCredential(SAMPLE_CREDENTIAL, publicKey, CRED_ID)

    await expect(
      decryptCredential(encrypted, otherKeyPair.privateKey, CRED_ID)
    ).rejects.toThrow('Decryption failed')
  })

  it('should fail to decrypt corrupted data', async () => {
    const encrypted = await encryptCredential(SAMPLE_CREDENTIAL, publicKey, CRED_ID)

    // Flip some bytes in the middle of the base64 string
    const corrupted =
      encrypted.slice(0, 50) +
      'AAAA' +
      encrypted.slice(54)

    await expect(
      decryptCredential(corrupted, privateKey, CRED_ID)
    ).rejects.toThrow('Decryption failed')
  })

  it('should fail to decrypt empty string', async () => {
    await expect(decryptCredential('', privateKey, CRED_ID)).rejects.toThrow()
  })

  it('should fail to decrypt invalid base64', async () => {
    await expect(
      decryptCredential('not-valid-base64!!!', privateKey, CRED_ID)
    ).rejects.toThrow()
  })
})

// ── End-to-End Flow ─────────────────────────────────────────────────────

describe('End-to-End: Setup → Unlock → Encrypt → Decrypt', () => {
  it('should complete full lifecycle', async () => {
    // 1. User creates vault
    const vault = await setupVault(VAULT_PASSWORD)

    // 2. Simulate: server stores publicKeyBase64, encryptedPrivateKeyBase64, saltBase64
    const serverStored = {
      publicKeyBase64: vault.publicKeyBase64,
      encryptedPrivateKeyBase64: vault.encryptedPrivateKeyBase64,
      saltBase64: vault.saltBase64,
    }

    // 3. User encrypts a credential (using in-memory keys from setup)
    const encrypted = await encryptCredential(SAMPLE_CREDENTIAL, vault.publicKey, CRED_ID)

    // 4. Simulate: server stores encrypted credential blob
    const storedBlob = encrypted

    // 5. New session: user unlocks vault
    const unlocked = await unlockVault(
      VAULT_PASSWORD,
      serverStored.saltBase64,
      serverStored.encryptedPrivateKeyBase64,
      serverStored.publicKeyBase64
    )

    // 6. User decrypts credential from server
    const decrypted = await decryptCredential(storedBlob, unlocked.privateKey, CRED_ID)
    expect(decrypted).toEqual(SAMPLE_CREDENTIAL)

    // 7. User creates another credential in this session
    const newCred: CredentialData = {
      name: 'Second Account',
      fields: { api_key: 'sk-abc123' },
    }
    const encrypted2 = await encryptCredential(newCred, unlocked.publicKey, CRED_ID)
    const decrypted2 = await decryptCredential(encrypted2, unlocked.privateKey, CRED_ID)
    expect(decrypted2).toEqual(newCred)
  }, 60000)

  it('should support multiple credentials with same vault', async () => {
    const vault = await setupVault(VAULT_PASSWORD)

    const credentials: CredentialData[] = [
      { name: 'Gmail', fields: { email: 'me@gmail.com', password: 'pass1' } },
      { name: 'GitHub', fields: { username: 'dev', token: 'ghp_xxx' } },
      { name: 'AWS', fields: { access_key: 'AK', secret_key: 'SK' } },
    ]

    // Encrypt all
    const encryptedBlobs = await Promise.all(
      credentials.map(c => encryptCredential(c, vault.publicKey, CRED_ID))
    )

    // Unlock in a new "session"
    const unlocked = await unlockVault(
      VAULT_PASSWORD,
      vault.saltBase64,
      vault.encryptedPrivateKeyBase64,
      vault.publicKeyBase64
    )

    // Decrypt all and verify
    const decrypted = await Promise.all(
      encryptedBlobs.map(blob => decryptCredential(blob, unlocked.privateKey, CRED_ID))
    )

    expect(decrypted).toEqual(credentials)
  }, 60000)
})

// ── Blob format v2: id binding, legacy compatibility, key handling ─────────

describe('Credential blob format', () => {
  let publicKey: CryptoKey
  let privateKey: CryptoKey

  beforeAll(async () => {
    const keyPair = await generateKeyPair()
    publicKey = keyPair.publicKey
    privateKey = keyPair.privateKey
  })

  it('produces v2 blobs and recognises legacy v1 blobs', async () => {
    const v2 = await encryptCredential(SAMPLE_CREDENTIAL, publicKey, CRED_ID)
    const v1 = await encryptCredentialLegacy(SAMPLE_CREDENTIAL, publicKey)
    expect(credentialBlobVersion(v2)).toBe(2)
    expect(credentialBlobVersion(v1)).toBe(1)
  })

  it('refuses to decrypt a v2 blob under a different credential id', async () => {
    const blob = await encryptCredential(SAMPLE_CREDENTIAL, publicKey, CRED_ID)
    await expect(decryptCredential(blob, privateKey, 'other-id')).rejects.toThrow('Decryption failed')
    await expect(decryptCredential(blob, privateKey)).rejects.toThrow('Decryption failed')
    const ok = await decryptCredential(blob, privateKey, CRED_ID)
    expect(ok).toEqual(SAMPLE_CREDENTIAL)
  })

  it('still decrypts legacy v1 blobs, with or without an id', async () => {
    const blob = await encryptCredentialLegacy(SAMPLE_CREDENTIAL, publicKey)
    expect(await decryptCredential(blob, privateKey)).toEqual(SAMPLE_CREDENTIAL)
    expect(await decryptCredential(blob, privateKey, CRED_ID)).toEqual(SAMPLE_CREDENTIAL)
  })

  it('requires a credential id to encrypt', async () => {
    await expect(encryptCredential(SAMPLE_CREDENTIAL, publicKey, '')).rejects.toThrow('credential id')
  })

  it('keeps the session private key non-extractable after setup and unlock', async () => {
    const vault = await setupVault(VAULT_PASSWORD)
    expect(vault.privateKey.extractable).toBe(false)
    expect(vault.kdfVersion).toBe(KDF_VERSION)
    const unlocked = await unlockVault(
      VAULT_PASSWORD,
      vault.saltBase64,
      vault.encryptedPrivateKeyBase64,
      vault.publicKeyBase64,
      vault.kdfVersion
    )
    expect(unlocked.privateKey.extractable).toBe(false)
  })

  it('rejects an unknown KDF version', async () => {
    const vault = await setupVault(VAULT_PASSWORD)
    await expect(
      unlockVault(VAULT_PASSWORD, vault.saltBase64, vault.encryptedPrivateKeyBase64, vault.publicKeyBase64, 99)
    ).rejects.toThrow('Unsupported vault key derivation version')
  })

  it('re-wraps the private key for a new password without changing the key pair', async () => {
    const vault = await setupVault(VAULT_PASSWORD)
    const blob = await encryptCredential(SAMPLE_CREDENTIAL, vault.publicKey, CRED_ID)

    const rewrapped = await rewrapPrivateKey(
      VAULT_PASSWORD,
      'brand-new-vault-password',
      vault.saltBase64,
      vault.encryptedPrivateKeyBase64,
      vault.kdfVersion
    )
    expect(rewrapped.saltBase64).not.toBe(vault.saltBase64)
    expect(rewrapped.kdfVersion).toBe(KDF_VERSION)

    const unlocked = await unlockVault(
      'brand-new-vault-password',
      rewrapped.saltBase64,
      rewrapped.encryptedPrivateKeyBase64,
      vault.publicKeyBase64,
      rewrapped.kdfVersion
    )
    expect(await decryptCredential(blob, unlocked.privateKey, CRED_ID)).toEqual(SAMPLE_CREDENTIAL)

    await expect(
      unlockVault(VAULT_PASSWORD, rewrapped.saltBase64, rewrapped.encryptedPrivateKeyBase64, vault.publicKeyBase64)
    ).rejects.toThrow()
  })

  it('refuses to re-wrap with the wrong current password', async () => {
    const vault = await setupVault(VAULT_PASSWORD)
    await expect(
      rewrapPrivateKey('wrong-password', 'new-password', vault.saltBase64, vault.encryptedPrivateKeyBase64)
    ).rejects.toThrow()
  })

  it('base64-encodes buffers larger than one chunk', () => {
    const big = new Uint8Array(200_000)
    for (let i = 0; i < big.length; i++) big[i] = i % 251
    const roundTrip = new Uint8Array(base64ToArrayBuffer(arrayBufferToBase64(big)))
    expect(roundTrip).toEqual(big)
  })
})
