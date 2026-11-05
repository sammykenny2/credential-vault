import { useCallback, useEffect, useRef } from 'react'
import { captureOperation, type VaultOperation } from '@/lib/operationGuard'
import { useAuthStore } from '@/stores/authStore'
import { useVaultKeyStore } from './useVaultKey'

/** Closing/unmounting a dialog also invalidates work that already passed authentication. */
export function useOperationGuard(isOpen = true) {
  const pending = useRef(new Set<VaultOperation>())
  const cancel = useCallback(() => {
    pending.current.forEach((operation) => operation.cancel())
    pending.current.clear()
  }, [])
  useEffect(() => {
    if (!isOpen) cancel()
    return cancel
  }, [isOpen, cancel])
  useEffect(() => {
    const auth = useAuthStore.subscribe((current, previous) => {
      if (current.generation !== previous.generation) cancel()
    })
    const vault = useVaultKeyStore.subscribe((current, previous) => {
      if (current.generation !== previous.generation) cancel()
    })
    return () => { auth(); vault(); cancel() }
  }, [cancel])
  const begin = useCallback((requireUnlocked = true) => {
    const operation = captureOperation(requireUnlocked)
    pending.current.add(operation)
    return { ...operation, finish: () => { pending.current.delete(operation); operation.cancel() } }
  }, [])
  return { begin, cancel }
}
