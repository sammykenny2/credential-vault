import { useAuthStore } from '@/stores/authStore'
import { useVaultKeyStore } from '@/hooks/useVaultKey'

export class OperationCancelledError extends Error {
  constructor() {
    super('This operation was cancelled because the session or vault changed. Please try again.')
    this.name = 'OperationCancelledError'
  }
}

/** Capture once, before the first await. Check before every later side effect. */
export type OperationCheck = (() => void) & { signal?: AbortSignal }

export function captureOperation(requireUnlocked = true, parent?: OperationCheck) {
  useVaultKeyStore.getState().checkTimeout()
  const authGeneration = useAuthStore.getState().generation
  const userId = useAuthStore.getState().user?.id
  const vaultGeneration = useVaultKeyStore.getState().generation
  const vault = {
    privateKey: requireUnlocked ? useVaultKeyStore.getState().privateKey : null,
    publicKey: requireUnlocked ? useVaultKeyStore.getState().publicKey : null,
    signer: requireUnlocked ? useVaultKeyStore.getState().signer : null,
    expectedPublicKeyBase64: requireUnlocked ? useVaultKeyStore.getState().expectedPublicKeyBase64 : null,
  }
  const controller = new AbortController()
  let cancelled = false
  const cancel = () => {
    cancelled = true
    vault.privateKey = null
    vault.publicKey = null
    vault.signer = null
    vault.expectedPublicKeyBase64 = null
    controller.abort()
    parent?.signal?.removeEventListener('abort', cancel)
  }
  parent?.signal?.addEventListener('abort', cancel, { once: true })
  const assertActive: OperationCheck = () => {
    parent?.()
    useVaultKeyStore.getState().checkTimeout()
    const currentAuth = useAuthStore.getState()
    const currentVault = useVaultKeyStore.getState()
    if (cancelled || authGeneration !== currentAuth.generation ||
        userId !== currentAuth.user?.id || vaultGeneration !== currentVault.generation ||
        (requireUnlocked && (!currentVault.privateKey || !currentVault.signer))) {
      throw new OperationCancelledError()
    }
  }
  assertActive.signal = controller.signal
  assertActive()
  return { assertActive, cancel, vault }
}

export type VaultOperation = ReturnType<typeof captureOperation>
