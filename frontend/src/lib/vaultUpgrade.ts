/**
 * One-time upgrade of an RSA-only vault to a signed one (ADR-004).
 *
 * Every existing record gets a signature labelled legacy-unverified. That does
 * not claim the record is authentic, since nothing can prove that afterwards. It
 * marks the set of records the user accepted at this moment, so that anything
 * added later without the signing key is refused rather than merely labelled.
 * The server stores the bundle and all signatures in one transaction.
 */

import api from '@/services/api'
import {
  arrayBufferToBase64,
  createVaultUpgradeKeys,
  type UnlockedVault,
  type VaultSigner,
} from './crypto'
import { RECORD_SIGNATURE_VERSION, signRecord, type StoredRecord } from './recordSigning'
import { upgradeProofHeaders } from './vaultProof'
import type { OperationCheck } from './operationGuard'

const SIGNED_VAULT_MARKER_PREFIX = 'credential-vault:signed-vault:'

/**
 * The server returned RSA-only key material for a vault this browser has seen
 * signed, or signed records for a vault with no signing key. Upgrading now would
 * sign whatever the server currently holds, so refuse.
 */
export class VaultRollbackError extends Error {
  constructor(
    message = 'The server returned older vault keys than this browser has seen. The vault ' +
      'stayed locked and nothing was signed. If you restored an old backup on purpose, clear ' +
      "this site's data in the browser and unlock again."
  ) {
    super(message)
    this.name = 'VaultRollbackError'
  }
}

/**
 * Keyed on the public key derived from the authenticated private key. Anything the
 * server supplies, such as the user id, could simply be changed to miss the marker.
 */
async function signedVaultMarker(publicKeyBase64: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(publicKeyBase64))
  return `${SIGNED_VAULT_MARKER_PREFIX}${arrayBufferToBase64(digest)}`
}

/** Not secret: only records that this browser has seen this vault signed. */
export async function rememberSignedVault(publicKeyBase64: string): Promise<void> {
  const marker = await signedVaultMarker(publicKeyBase64)
  try {
    localStorage.setItem(marker, '1')
  } catch {
    // Storage may be unavailable; the marker only adds detection on this device.
  }
}

export async function hasSeenSignedVault(publicKeyBase64: string): Promise<boolean> {
  const marker = await signedVaultMarker(publicKeyBase64)
  try {
    return localStorage.getItem(marker) === '1'
  } catch {
    return false
  }
}

/**
 * Whether this browser has unlocked any signed vault. The setup screen has no
 * key to check, so a server claiming "no vault yet" can only be questioned this way.
 */
export function hasSeenAnySignedVault(): boolean {
  try {
    return Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
      .some((key) => key?.startsWith(SIGNED_VAULT_MARKER_PREFIX))
  } catch {
    return false
  }
}

/** Sign every existing record and store the new key bundle, all or nothing. */
export async function performVaultUpgrade(
  unlocked: UnlockedVault,
  records: StoredRecord[],
  assertActive: OperationCheck = () => {}
): Promise<VaultSigner> {
  if (!unlocked.pendingUpgrade) throw new Error('This vault does not need an upgrade.')
  if (records.some((record) => record.signature !== null)) throw new VaultRollbackError()

  const keys = await createVaultUpgradeKeys(unlocked.pendingUpgrade)
  assertActive()
  const adoptions = await Promise.all(records.map(async (record) => {
    const revision = record.revision + 1
    const { signature } = await signRecord(
      { ...record, revision, origin: 'legacy-unverified' },
      keys.signer
    )
    return {
      id: record.id,
      revision,
      signature,
      signature_version: RECORD_SIGNATURE_VERSION,
      origin: 'legacy-unverified',
    }
  }))
  assertActive()
  const headers = await upgradeProofHeaders(unlocked.privateKey)
  assertActive()

  await api.post(
    '/auth/vault/upgrade',
    {
      encrypted_private_key: keys.encryptedPrivateKeyBase64,
      signing_public_key: keys.signingPublicKeyBase64,
      adoptions,
    },
    { headers, assertOperation: assertActive }
  )
  assertActive()
  return keys.signer
}
