/**
 * Proof of vault unlock.
 *
 * Deleting a credential or overwriting its ciphertext requires more than a
 * session token: the server encrypts a random challenge with the vault's
 * public key and only the unlocked private key held in memory can decrypt it.
 * The decrypted value travels back in the X-Vault-Proof header and stays valid
 * for a few minutes, so a batch of deletes needs one round trip.
 */

import api from '@/services/api'
import { useVaultKeyStore } from '@/hooks/useVaultKey'
import { arrayBufferToBase64, base64ToArrayBuffer } from './crypto'

export const VAULT_PROOF_HEADER = 'X-Vault-Proof'
export const VAULT_PROOF_OAEP_LABEL = 'credential-vault/vault-proof/v1'

export class VaultLockedError extends Error {
  constructor(message = 'Vault is locked. Unlock it to make this change.') {
    super(message)
    this.name = 'VaultLockedError'
  }
}

interface CachedProof {
  /** The private key the proof was produced with; a new unlock invalidates it. */
  key: CryptoKey
  proof: string
  expiresAt: number
}

let cached: CachedProof | null = null
let pending: { key: CryptoKey; promise: Promise<string> } | null = null
let generation = 0

/** Renew this long before the server-side expiry so in-flight batches do not race it. */
const RENEW_MARGIN_MS = 30_000
const MIN_PROOF_TTL_SECONDS = 60
const MAX_PROOF_TTL_SECONDS = 300

function assertCurrentKey(privateKey: CryptoKey, requestGeneration: number): void {
  useVaultKeyStore.getState().checkTimeout()
  if (requestGeneration !== generation || useVaultKeyStore.getState().privateKey !== privateKey) {
    throw new VaultLockedError()
  }
}

async function requestProof(privateKey: CryptoKey, requestGeneration: number): Promise<string> {
  const requestedAt = Date.now()
  const { data } = await api.post<{ challenge: string; expires_in: number }>(
    '/auth/vault/challenge'
  )
  if (!Number.isInteger(data.expires_in) || data.expires_in < MIN_PROOF_TTL_SECONDS ||
      data.expires_in > MAX_PROOF_TTL_SECONDS) {
    throw new Error('Invalid vault proof lifetime')
  }
  assertCurrentKey(privateKey, requestGeneration)
  const secret = await crypto.subtle.decrypt(
    { name: 'RSA-OAEP', label: new TextEncoder().encode(VAULT_PROOF_OAEP_LABEL) },
    privateKey,
    base64ToArrayBuffer(data.challenge)
  )
  try {
    assertCurrentKey(privateKey, requestGeneration)
    if (secret.byteLength !== 32) throw new Error('Invalid vault proof challenge')
    const proof = arrayBufferToBase64(secret)
    cached = { key: privateKey, proof, expiresAt: requestedAt + data.expires_in * 1000 }
    return proof
  } finally {
    new Uint8Array(secret).fill(0)
  }
}

/**
 * Return a currently valid proof, fetching and decrypting a new challenge
 * when there is none. Throws VaultLockedError when the vault is locked.
 */
export async function getVaultProof(): Promise<string> {
  const store = useVaultKeyStore.getState()
  store.checkTimeout()
  const privateKey = useVaultKeyStore.getState().privateKey
  if (!privateKey) throw new VaultLockedError()

  if (cached && cached.key === privateKey && Date.now() < cached.expiresAt - RENEW_MARGIN_MS) {
    return cached.proof
  }

  if (pending?.key === privateKey) return pending.promise
  const request = { key: privateKey, promise: requestProof(privateKey, generation) }
  pending = request
  try {
    return await request.promise
  } finally {
    if (pending === request) pending = null
  }
}

/** Headers to attach to a destructive request. */
export async function vaultProofHeaders(): Promise<Record<string, string>> {
  return { [VAULT_PROOF_HEADER]: await getVaultProof() }
}

export function clearVaultProof(): void {
  generation += 1
  cached = null
  pending = null
}
