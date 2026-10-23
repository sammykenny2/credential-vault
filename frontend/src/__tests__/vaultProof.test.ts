/**
 * Proof-of-unlock tests: the challenge is decrypted with the in-memory private
 * key, cached until near expiry, and refused while the vault is locked.
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'

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
} from '@/lib/vaultProof'

const mockedPost = (api as unknown as { post: ReturnType<typeof vi.fn> }).post

let keyPair: CryptoKeyPair

async function challengeFor(publicKey: CryptoKey, secret: Uint8Array): Promise<string> {
  const ciphertext = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, publicKey, secret)
  return arrayBufferToBase64(ciphertext)
}

function randomSecret(): Uint8Array {
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
    useVaultKeyStore.getState().setKeys(keyPair.privateKey, keyPair.publicKey, 'pub')
    mockedPost.mockResolvedValue({
      data: { challenge: await challengeFor(keyPair.publicKey, randomSecret()), expires_in: 10 },
    })

    await getVaultProof()
    await getVaultProof()

    expect(mockedPost).toHaveBeenCalledTimes(2)
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
