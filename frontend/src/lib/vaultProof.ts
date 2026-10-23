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

/** Renew this long before the server-side expiry so in-flight batches do not race it. */
const RENEW_MARGIN_MS = 30_000

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

  const { data } = await api.post<{ challenge: string; expires_in: number }>(
    '/auth/vault/challenge'
  )
  const secret = await crypto.subtle.decrypt(
    { name: 'RSA-OAEP' },
    privateKey,
    base64ToArrayBuffer(data.challenge)
  )
  const proof = arrayBufferToBase64(secret)
  cached = { key: privateKey, proof, expiresAt: Date.now() + data.expires_in * 1000 }
  return proof
}

/** Headers to attach to a destructive request. */
export async function vaultProofHeaders(): Promise<Record<string, string>> {
  return { [VAULT_PROOF_HEADER]: await getVaultProof() }
}

export function clearVaultProof(): void {
  cached = null
}
