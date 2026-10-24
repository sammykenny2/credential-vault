/**
 * Vault state in the sidebar: lock the vault now, or go unlock it.
 *
 * Locking drops the decrypted private key and the cached vault proof from
 * memory; pages that show plaintext drop it when they see the vault locked.
 * The interval makes the auto-lock timeout take effect on time: without it the
 * key stayed in memory past the timeout until something next used it.
 */

import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Lock, LockOpen } from 'lucide-react'
import { useVaultKey, useVaultKeyStore } from '@/hooks/useVaultKey'
import { clearVaultProof } from '@/lib/vaultProof'

export const AUTO_LOCK_CHECK_MS = 10_000

const itemClass =
  'flex items-center gap-3 w-full px-4 py-3 text-gray-300 hover:bg-gray-800 rounded-lg transition-colors'

export default function VaultLockControl() {
  const { isUnlocked, clearKeys } = useVaultKey()

  useEffect(() => {
    const timer = setInterval(() => useVaultKeyStore.getState().checkTimeout(), AUTO_LOCK_CHECK_MS)
    return () => clearInterval(timer)
  }, [])

  const lockNow = () => {
    clearKeys()
    clearVaultProof()
  }

  if (!isUnlocked) {
    return (
      <Link to="/credentials" className={itemClass}>
        <Lock className="w-5 h-5" />
        Unlock Vault
      </Link>
    )
  }

  return (
    <button onClick={lockNow} className={itemClass} title="Lock the vault now">
      <LockOpen className="w-5 h-5 text-green-400" />
      Lock Vault
    </button>
  )
}
