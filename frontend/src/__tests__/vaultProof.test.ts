/**
 * Proof of vault unlock: proof v2 signs a server nonce with the vault's ECDSA key;
 * proof v1 only exists for the one-time upgrade and depends on its OAEP label.
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'

vi.mock('@/services/api', () => ({
  default: {
    post: vi.fn(),
  },
}))

import api from '@/services/api'
import { arrayBufferToBase64, generateKeyPair, type VaultSigner } from '@/lib/crypto'
import { useVaultKeyStore } from '@/hooks/useVaultKey'
import {
  clearVaultProof,
  getVaultProof,
  SIGNED_PROOF_DOMAIN,
  SIGNED_PROOF_VERSION,
  upgradeProofHeaders,
  VAULT_PROOF_HEADER,
  VAULT_PROOF_OAEP_LABEL,
  VaultLockedError,
  vaultProofHeaders,
} from '@/lib/vaultProof'
import vectors from './fixtures/vault_signature_vectors.json'

const mockedPost = (api as unknown as { post: ReturnType<typeof vi.fn> }).post

const NONCE = 'A'.repeat(75)
const TICKET = 'B'.repeat(32)
const ECDSA = { name: 'ECDSA', namedCurve: 'P-256' } as const
const ECDSA_SIGN = { name: 'ECDSA', hash: 'SHA-256' } as const

let rsa: CryptoKeyPair
let signer: VaultSigner

async function newSigner(): Promise<VaultSigner> {
  const pair = await crypto.subtle.generateKey(ECDSA, false, ['sign', 'verify'])
  return {
    signingKey: pair.privateKey,
    verifyKey: pair.publicKey,
    vaultId: '11111111-2222-4333-8444-555555555555',
    signerId: 'a'.repeat(64),
  }
}

function challenge(nonce = NONCE, expiresIn: number = 300) {
  return { data: { version: 2, nonce, expires_in: expiresIn } }
}

function unlock(): void {
  useVaultKeyStore.getState().setKeys(rsa.privateKey, rsa.publicKey, 'pub', signer)
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(binary, (c) => c.charCodeAt(0))
}

describe('vaultProof', () => {
  beforeAll(async () => {
    rsa = await generateKeyPair()
    signer = await newSigner()
  })

  beforeEach(() => {
    useVaultKeyStore.getState().clearKeys()
    clearVaultProof()
    mockedPost.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('refuses while the vault is locked', async () => {
    await expect(getVaultProof()).rejects.toBeInstanceOf(VaultLockedError)
    expect(mockedPost).not.toHaveBeenCalled()
  })

  it('refuses when the vault has no signing key', async () => {
    useVaultKeyStore.getState().setKeys(rsa.privateKey, rsa.publicKey, 'pub')
    await expect(getVaultProof()).rejects.toBeInstanceOf(VaultLockedError)
    expect(mockedPost).not.toHaveBeenCalled()
  })

  it('signs the nonce in the format the server checks', async () => {
    unlock()
    mockedPost.mockResolvedValue(challenge())

    const headers = await vaultProofHeaders()

    const [version, nonce, signature] = headers[VAULT_PROOF_HEADER].split('.')
    expect(version).toBe('v2')
    expect(nonce).toBe(NONCE)
    const message = JSON.stringify([SIGNED_PROOF_DOMAIN, SIGNED_PROOF_VERSION, NONCE])
    expect(await crypto.subtle.verify(
      ECDSA_SIGN, signer.verifyKey, fromBase64Url(signature), new TextEncoder().encode(message)
    )).toBe(true)
    expect(mockedPost).toHaveBeenCalledWith('/auth/vault/challenge')
  })

  it('reuses a live proof, so a batch needs one round trip', async () => {
    unlock()
    mockedPost.mockResolvedValue(challenge())

    const first = await getVaultProof()
    const second = await getVaultProof()

    expect(second).toBe(first)
    expect(mockedPost).toHaveBeenCalledTimes(1)
  })

  it('fetches a new challenge when the cached proof is about to expire', async () => {
    const now = Date.now()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now)
    unlock()
    mockedPost.mockResolvedValue(challenge())

    await getVaultProof()
    clock.mockReturnValue(now + 271_000)
    await getVaultProof()

    expect(mockedPost).toHaveBeenCalledTimes(2)
  })

  it('never answers a proof v1 challenge once the vault can sign', async () => {
    // A server asking for this is asking the browser to return an RSA decryption.
    unlock()
    const decrypt = vi.spyOn(crypto.subtle, 'decrypt')
    mockedPost.mockResolvedValue({
      data: { version: 1, challenge: 'QUFB', expires_in: 300 },
    })

    await expect(getVaultProof()).rejects.toThrow('Invalid vault proof challenge')
    expect(decrypt).not.toHaveBeenCalled()
  })

  it.each([0, 10, 59, 301, NaN, Infinity])('rejects invalid proof lifetime %s', async (expiresIn) => {
    unlock()
    mockedPost.mockResolvedValue(challenge(NONCE, expiresIn))
    await expect(getVaultProof()).rejects.toThrow('Invalid vault proof lifetime')
  })

  it.each([
    ['too short', 'A'.repeat(31)],
    ['too long', 'A'.repeat(129)],
    ['outside the alphabet', `${'A'.repeat(40)}","x`],
    ['with a separator', `${'A'.repeat(40)}.${'A'.repeat(40)}`],
    ['empty', ''],
    ['an array that stringifies to a valid nonce', [NONCE] as unknown as string],
  ])('refuses to sign a nonce that is %s', async (_label, nonce) => {
    unlock()
    const sign = vi.spyOn(crypto.subtle, 'sign')
    mockedPost.mockResolvedValue(challenge(nonce))

    await expect(getVaultProof()).rejects.toThrow('Invalid vault proof challenge')
    expect(sign).not.toHaveBeenCalled()
  })

  it('shares a single in-flight challenge between concurrent requests', async () => {
    unlock()
    mockedPost.mockResolvedValue(challenge())

    const proofs = await Promise.all([getVaultProof(), getVaultProof(), getVaultProof()])

    expect(new Set(proofs).size).toBe(1)
    expect(mockedPost).toHaveBeenCalledTimes(1)
  })

  it('discards a challenge result after locking while the request is pending', async () => {
    unlock()
    let complete!: (value: unknown) => void
    mockedPost.mockReturnValue(new Promise((resolve) => { complete = resolve }))

    const rejected = expect(getVaultProof()).rejects.toBeInstanceOf(VaultLockedError)
    clearVaultProof()
    useVaultKeyStore.getState().clearKeys()
    complete(challenge())

    await rejected
  })

  it('drops the cache when the vault is unlocked with a different key', async () => {
    unlock()
    mockedPost.mockResolvedValue(challenge())
    await getVaultProof()

    const otherRsa = await generateKeyPair()
    useVaultKeyStore.getState().setKeys(
      otherRsa.privateKey, otherRsa.publicKey, 'pub2', await newSigner()
    )
    await getVaultProof()

    expect(mockedPost).toHaveBeenCalledTimes(2)
  })

  it('drops the cached proof when auto-lock clears the keys', async () => {
    const now = Date.now()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now)
    unlock()
    mockedPost.mockResolvedValue(challenge())
    await getVaultProof()

    // The timer path: checkTimeout clears the keys without calling lockVault().
    clock.mockReturnValue(now + 16 * 60 * 1000)
    useVaultKeyStore.getState().checkTimeout()
    clock.mockReturnValue(now)
    unlock()
    await getVaultProof()

    expect(mockedPost).toHaveBeenCalledTimes(2)
  })
})

describe('upgradeProofHeaders (proof v1)', () => {
  const label = new TextEncoder().encode(VAULT_PROOF_OAEP_LABEL)

  beforeAll(async () => {
    rsa = await generateKeyPair()
  })

  beforeEach(() => {
    mockedPost.mockReset()
  })

  async function labelledChallenge(secret: Uint8Array<ArrayBuffer>): Promise<string> {
    return arrayBufferToBase64(
      await crypto.subtle.encrypt({ name: 'RSA-OAEP', label }, rsa.publicKey, secret)
    )
  }

  it('returns the ticket with the labelled secret', async () => {
    const secret = crypto.getRandomValues(new Uint8Array(32))
    mockedPost.mockResolvedValue({
      data: { version: 1, challenge: await labelledChallenge(secret), ticket: TICKET, expires_in: 300 },
    })

    const headers = await upgradeProofHeaders(rsa.privateKey)

    const [version, ticket, encoded] = headers[VAULT_PROOF_HEADER].split('.')
    expect(version).toBe('v1')
    expect(ticket).toBe(TICKET)
    expect(fromBase64Url(encoded)).toEqual(secret)
  })

  it('cannot be used to unwrap a credential key', async () => {
    // Credential AES keys are wrapped with the same RSA key and no label.
    const wrappedCredentialKey = await crypto.subtle.encrypt(
      { name: 'RSA-OAEP' }, rsa.publicKey, crypto.getRandomValues(new Uint8Array(32))
    )
    mockedPost.mockResolvedValue({
      data: { version: 1, challenge: arrayBufferToBase64(wrappedCredentialKey), ticket: TICKET, expires_in: 300 },
    })

    await expect(upgradeProofHeaders(rsa.privateKey)).rejects.toThrow()
  })

  it('rejects an unexpected plaintext length', async () => {
    mockedPost.mockResolvedValue({
      data: { version: 1, challenge: await labelledChallenge(new Uint8Array(31)), ticket: TICKET, expires_in: 300 },
    })
    await expect(upgradeProofHeaders(rsa.privateKey)).rejects.toThrow('Invalid vault proof challenge')
  })

  it('rejects a signed-proof challenge and invalid lifetimes', async () => {
    mockedPost.mockResolvedValue(challenge())
    await expect(upgradeProofHeaders(rsa.privateKey)).rejects.toThrow('Invalid vault proof challenge')

    mockedPost.mockResolvedValue({ data: { version: 1, challenge: 'QUFB', ticket: TICKET, expires_in: 5 } })
    await expect(upgradeProofHeaders(rsa.privateKey)).rejects.toThrow('Invalid vault proof lifetime')

    mockedPost.mockResolvedValue({ data: { version: 1, challenge: 'QUFB', ticket: 'bad.ticket', expires_in: 300 } })
    await expect(upgradeProofHeaders(rsa.privateKey)).rejects.toThrow('Invalid vault proof challenge')

    mockedPost.mockResolvedValue({ data: { version: 1, challenge: 'QUFB', ticket: [TICKET], expires_in: 300 } })
    await expect(upgradeProofHeaders(rsa.privateKey)).rejects.toThrow('Invalid vault proof challenge')
  })
})

describe('shared test vectors', () => {
  it('uses the same proof v1 label as the backend', () => {
    expect(VAULT_PROOF_OAEP_LABEL).toBe(vectors.proof_v1_oaep_label)
  })

  it('builds the same proof v2 message as the backend', async () => {
    const { spki, nonce, message, signature } = vectors.proof
    expect(JSON.stringify([SIGNED_PROOF_DOMAIN, SIGNED_PROOF_VERSION, nonce])).toBe(message)

    const key = await crypto.subtle.importKey(
      'spki', Uint8Array.from(atob(spki), (c) => c.charCodeAt(0)), ECDSA, true, ['verify']
    )
    expect(await crypto.subtle.verify(
      ECDSA_SIGN, key, fromBase64Url(signature), new TextEncoder().encode(message)
    )).toBe(true)
  })
})
