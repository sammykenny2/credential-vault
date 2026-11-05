/**
 * Proof of vault unlock.
 *
 * Changing vault data or accounts requires more than a session token. The server
 * hands out a nonce and the browser signs it with the vault's ECDSA key, which
 * only exists in memory while the vault is unlocked (proof v2). The signed nonce
 * travels in the X-Vault-Proof header and stays valid for a few minutes, so a
 * batch of writes needs one round trip.
 *
 * Signing a domain-separated message can reveal nothing about the vault, unlike
 * proof v1, where the browser returns an RSA decryption. Credential AES keys are
 * wrapped with that same RSA key, so v1 depends on its OAEP label to stop a
 * malicious server from using it as a decryption oracle. v1 survives only to
 * authorize the one-time upgrade of a vault that has no signing key yet.
 */

import api from '@/services/api'
import { useVaultKeyStore } from '@/hooks/useVaultKey'
import { arrayBufferToBase64, base64ToArrayBuffer, type VaultSigner } from './crypto'

export const VAULT_PROOF_HEADER = 'X-Vault-Proof'
export const VAULT_PROOF_OAEP_LABEL = 'credential-vault/vault-proof/v1'
export const SIGNED_PROOF_DOMAIN = 'credential-vault/vault-proof'
export const SIGNED_PROOF_VERSION = 2

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

interface ChallengeResponse {
  version?: number
  nonce?: string
  challenge?: string
  ticket?: string
  expires_in: number
}

let cached: CachedProof | null = null
let pending: { key: CryptoKey; promise: Promise<string> } | null = null
let generation = 0

/** Renew this long before the server-side expiry so in-flight batches do not race it. */
const RENEW_MARGIN_MS = 30_000
const MIN_PROOF_TTL_SECONDS = 60
const MAX_PROOF_TTL_SECONDS = 300
/** A server-chosen string goes into a signed message, so it is held to a strict shape. */
const NONCE_PATTERN = /^[A-Za-z0-9_-]{32,128}$/
const TICKET_PATTERN = /^[A-Za-z0-9_-]{16,64}$/

function assertLifetime(expiresIn: number): void {
  if (!Number.isInteger(expiresIn) || expiresIn < MIN_PROOF_TTL_SECONDS ||
      expiresIn > MAX_PROOF_TTL_SECONDS) {
    throw new Error('Invalid vault proof lifetime')
  }
}

function assertCurrentKey(privateKey: CryptoKey, requestGeneration: number): void {
  useVaultKeyStore.getState().checkTimeout()
  if (requestGeneration !== generation || useVaultKeyStore.getState().privateKey !== privateKey) {
    throw new VaultLockedError()
  }
}

function toBase64Url(buffer: ArrayBuffer): string {
  return arrayBufferToBase64(buffer).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function requestProof(
  privateKey: CryptoKey,
  signer: VaultSigner,
  requestGeneration: number
): Promise<string> {
  const requestedAt = Date.now()
  const { data } = await api.post<ChallengeResponse>('/auth/vault/challenge')
  assertLifetime(data.expires_in)
  // Never answer anything but a signed-proof challenge once the vault can sign:
  // a server asking for proof v1 here is asking for an RSA decryption.
  if (data.version !== SIGNED_PROOF_VERSION || typeof data.nonce !== 'string' ||
      !NONCE_PATTERN.test(data.nonce)) {
    throw new Error('Invalid vault proof challenge')
  }
  assertCurrentKey(privateKey, requestGeneration)
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    signer.signingKey,
    new TextEncoder().encode(JSON.stringify([SIGNED_PROOF_DOMAIN, SIGNED_PROOF_VERSION, data.nonce]))
  )
  assertCurrentKey(privateKey, requestGeneration)
  const proof = `v2.${data.nonce}.${toBase64Url(signature)}`
  cached = { key: privateKey, proof, expiresAt: requestedAt + data.expires_in * 1000 }
  return proof
}

/**
 * Return a currently valid proof, fetching and signing a new challenge when
 * there is none. Throws VaultLockedError when the vault is locked.
 */
export async function getVaultProof(): Promise<string> {
  const store = useVaultKeyStore.getState()
  store.checkTimeout()
  const { privateKey, signer } = useVaultKeyStore.getState()
  if (!privateKey || !signer) throw new VaultLockedError()

  if (cached && cached.key === privateKey && Date.now() < cached.expiresAt - RENEW_MARGIN_MS) {
    return cached.proof
  }

  if (pending?.key === privateKey) return pending.promise
  const request = { key: privateKey, promise: requestProof(privateKey, signer, generation) }
  pending = request
  try {
    return await request.promise
  } finally {
    if (pending === request) pending = null
  }
}

/** Headers to attach to a write. */
export async function vaultProofHeaders(): Promise<Record<string, string>> {
  return { [VAULT_PROOF_HEADER]: await getVaultProof() }
}

/**
 * Proof v1, for the one-time upgrade only: decrypt a secret labelled for this
 * purpose. The label means a wrapped credential key can never be answered here.
 */
export async function upgradeProofHeaders(privateKey: CryptoKey): Promise<Record<string, string>> {
  const { data } = await api.post<ChallengeResponse>('/auth/vault/challenge')
  assertLifetime(data.expires_in)
  if (data.version !== 1 || typeof data.challenge !== 'string' ||
      typeof data.ticket !== 'string' || !TICKET_PATTERN.test(data.ticket)) {
    throw new Error('Invalid vault proof challenge')
  }
  const secret = await crypto.subtle.decrypt(
    { name: 'RSA-OAEP', label: new TextEncoder().encode(VAULT_PROOF_OAEP_LABEL) },
    privateKey,
    base64ToArrayBuffer(data.challenge)
  )
  try {
    if (secret.byteLength !== 32) throw new Error('Invalid vault proof challenge')
    return { [VAULT_PROOF_HEADER]: `v1.${data.ticket}.${toBase64Url(secret)}` }
  } finally {
    new Uint8Array(secret).fill(0)
  }
}

export function clearVaultProof(): void {
  generation += 1
  cached = null
  pending = null
}

// Auto-lock clears the keys without going through lockVault(): drop the proof too,
// so it does not outlive the unlocked session in memory.
useVaultKeyStore.subscribe((state) => {
  if (!state.privateKey && (cached || pending)) clearVaultProof()
})
