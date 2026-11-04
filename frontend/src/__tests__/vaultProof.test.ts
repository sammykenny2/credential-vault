/**
 * Proof-of-unlock tests: the challenge is decrypted with the in-memory private
 * key, cached until near expiry, and refused while the vault is locked.
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'

vi.mock('@/services/api', () => ({
  default: {
    post: vi.fn(),
  },
}))

import api from '@/services/api'
import { useVaultKeyStore } from '@/hooks/useVaultKey'
import { generateKeyPair, arrayBufferToBase64, base64ToArrayBuffer } from '@/lib/crypto'
import {
  getVaultProof,
  vaultProofHeaders,
  clearVaultProof,
  VaultLockedError,
  VAULT_PROOF_HEADER,
  VAULT_PROOF_OAEP_LABEL,
} from '@/lib/vaultProof'

const mockedPost = (api as unknown as { post: ReturnType<typeof vi.fn> }).post

let keyPair: CryptoKeyPair

async function challengeFor(publicKey: CryptoKey, secret: Uint8Array<ArrayBuffer>): Promise<string> {
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'RSA-OAEP', label: new TextEncoder().encode(VAULT_PROOF_OAEP_LABEL) }, publicKey, secret
  )
  return arrayBufferToBase64(ciphertext)
}

function randomSecret(): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(32))
}

describe('vaultProof', () => {
  beforeAll(async () => {
    keyPair = await generateKeyPair()
  })

  beforeEach(() => {
    clearVaultProof()
    useVaultKeyStore.getState().clearKeys()
    mockedPost.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('refuses while the vault is locked', async () => {
    await expect(getVaultProof()).rejects.toBeInstanceOf(VaultLockedError)
    expect(mockedPost).not.toHaveBeenCalled()
  })

  it('decrypts the challenge with the private key and returns the secret', async () => {
    useVaultKeyStore.getState().setKeys(keyPair.privateKey, keyPair.publicKey, 'pub')
    const secret = randomSecret()
    mockedPost.mockResolvedValue({
      data: { challenge: await challengeFor(keyPair.publicKey, secret), expires_in: 300 },
    })

    const proof = await getVaultProof()

    expect(new Uint8Array(base64ToArrayBuffer(proof))).toEqual(secret)
    expect(mockedPost).toHaveBeenCalledWith('/auth/vault/challenge')
    expect(await vaultProofHeaders()).toEqual({ [VAULT_PROOF_HEADER]: proof })
  })

  it('reuses a fresh proof instead of asking for a new challenge', async () => {
    useVaultKeyStore.getState().setKeys(keyPair.privateKey, keyPair.publicKey, 'pub')
    mockedPost.mockResolvedValue({
      data: { challenge: await challengeFor(keyPair.publicKey, randomSecret()), expires_in: 300 },
    })

    const first = await getVaultProof()
    const second = await getVaultProof()

    expect(second).toBe(first)
    expect(mockedPost).toHaveBeenCalledTimes(1)
  })

  it('fetches a new challenge when the cached proof is about to expire', async () => {
    const now = Date.now()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now)
    useVaultKeyStore.getState().setKeys(keyPair.privateKey, keyPair.publicKey, 'pub')
    mockedPost.mockResolvedValue({
      data: { challenge: await challengeFor(keyPair.publicKey, randomSecret()), expires_in: 300 },
    })

    await getVaultProof()
    clock.mockReturnValue(now + 271_000)
    await getVaultProof()

    expect(mockedPost).toHaveBeenCalledTimes(2)
  })

  it('rejects ciphertext from an unlabeled RSA-OAEP domain', async () => {
    useVaultKeyStore.getState().setKeys(keyPair.privateKey, keyPair.publicKey, 'pub')
    const ciphertext = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, keyPair.publicKey, randomSecret())
    mockedPost.mockResolvedValue({
      data: { challenge: arrayBufferToBase64(ciphertext), expires_in: 300 },
    })
    await expect(vaultProofHeaders()).rejects.toThrow()
  })

  it.each([0, 10, 301, NaN, Infinity])('rejects invalid proof lifetime %s', async (expiresIn) => {
    useVaultKeyStore.getState().setKeys(keyPair.privateKey, keyPair.publicKey, 'pub')
    mockedPost.mockResolvedValue({
      data: { challenge: await challengeFor(keyPair.publicKey, randomSecret()), expires_in: expiresIn },
    })
    await expect(getVaultProof()).rejects.toThrow('Invalid vault proof lifetime')
  })

  it('rejects a challenge with an unexpected plaintext length', async () => {
    useVaultKeyStore.getState().setKeys(keyPair.privateKey, keyPair.publicKey, 'pub')
    mockedPost.mockResolvedValue({
      data: { challenge: await challengeFor(keyPair.publicKey, new Uint8Array(31)), expires_in: 300 },
    })
    await expect(getVaultProof()).rejects.toThrow('Invalid vault proof challenge')
  })

  it('shares a single in-flight challenge between concurrent requests', async () => {
    useVaultKeyStore.getState().setKeys(keyPair.privateKey, keyPair.publicKey, 'pub')
    mockedPost.mockResolvedValue({
      data: { challenge: await challengeFor(keyPair.publicKey, randomSecret()), expires_in: 300 },
    })
    const proofs = await Promise.all([getVaultProof(), getVaultProof(), getVaultProof()])
    expect(new Set(proofs).size).toBe(1)
    expect(mockedPost).toHaveBeenCalledTimes(1)
  })

  it('discards a challenge result after locking while the request is pending', async () => {
    useVaultKeyStore.getState().setKeys(keyPair.privateKey, keyPair.publicKey, 'pub')
    const challenge = await challengeFor(keyPair.publicKey, randomSecret())
    let complete!: (value: unknown) => void
    mockedPost.mockReturnValue(new Promise((resolve) => { complete = resolve }))
    const rejected = expect(getVaultProof()).rejects.toBeInstanceOf(VaultLockedError)
    clearVaultProof()
    useVaultKeyStore.getState().clearKeys()
    complete({ data: { challenge, expires_in: 300 } })
    await rejected
  })

  it('drops the cache when the vault is unlocked with a different key', async () => {
    useVaultKeyStore.getState().setKeys(keyPair.privateKey, keyPair.publicKey, 'pub')
    mockedPost.mockResolvedValue({
      data: { challenge: await challengeFor(keyPair.publicKey, randomSecret()), expires_in: 300 },
    })
    await getVaultProof()

    const otherPair = await generateKeyPair()
    useVaultKeyStore.getState().setKeys(otherPair.privateKey, otherPair.publicKey, 'pub2')
    mockedPost.mockResolvedValue({
      data: { challenge: await challengeFor(otherPair.publicKey, randomSecret()), expires_in: 300 },
    })

    await getVaultProof()
    expect(mockedPost).toHaveBeenCalledTimes(2)
  })

  it('fails once the vault auto-locks', async () => {
    useVaultKeyStore.getState().setKeys(keyPair.privateKey, keyPair.publicKey, 'pub')
    useVaultKeyStore.setState({ lastActivity: Date.now() - 16 * 60 * 1000 })

    await expect(getVaultProof()).rejects.toBeInstanceOf(VaultLockedError)
  })
})
