/**
 * Locking the vault.
 *
 * Locking drops the decrypted private key and the cached vault proof from
 * memory; pages that show plaintext drop it when they see the vault locked.
 */

import { useEffect } from 'react'
import { useVaultKeyStore } from '@/hooks/useVaultKey'
import { clearVaultProof } from '@/lib/vaultProof'

export const AUTO_LOCK_CHECK_MS = 10_000

/** Lock the vault now. */
export function lockVault(): void {
  useVaultKeyStore.getState().clearKeys()
  clearVaultProof()
}

/**
 * Make the auto-lock timeout take effect on time: without this the key stayed
 * in memory past the timeout until something next used it. Mounted once, in
 * Layout.
 */
export function useAutoLock(): void {
  useEffect(() => {
    const timer = setInterval(() => useVaultKeyStore.getState().checkTimeout(), AUTO_LOCK_CHECK_MS)
    return () => clearInterval(timer)
  }, [])
}
