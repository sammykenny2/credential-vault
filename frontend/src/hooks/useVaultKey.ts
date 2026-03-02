/**
 * React hook for managing the E2EE vault key.
 *
 * Stores the decrypted RSA private key and public key in memory.
 * Never sent to the server. Cleared on logout/timeout.
 */

import { create } from 'zustand'

interface VaultKeyState {
  // RSA key pair (in memory only, never persisted)
  privateKey: CryptoKey | null
  publicKey: CryptoKey | null
  // Timestamp when vault was last unlocked
  lastActivity: number | null
  // Session timeout in milliseconds (default: 15 minutes)
  sessionTimeout: number

  // Actions
  setKeys: (privateKey: CryptoKey, publicKey: CryptoKey) => void
  clearKeys: () => void
  isUnlocked: () => boolean
  updateActivity: () => void
  checkTimeout: () => boolean
}

export const useVaultKeyStore = create<VaultKeyState>((set, get) => ({
  privateKey: null,
  publicKey: null,
  lastActivity: null,
  sessionTimeout: 15 * 60 * 1000, // 15 minutes

  setKeys: (privateKey: CryptoKey, publicKey: CryptoKey) => {
    set({
      privateKey,
      publicKey,
      lastActivity: Date.now(),
    })
  },

  clearKeys: () => {
    set({
      privateKey: null,
      publicKey: null,
      lastActivity: null,
    })
  },

  isUnlocked: () => {
    const { privateKey, publicKey, lastActivity, sessionTimeout } = get()
    if (!privateKey || !publicKey || !lastActivity) return false
    return Date.now() - lastActivity < sessionTimeout
  },

  updateActivity: () => {
    set({ lastActivity: Date.now() })
  },

  checkTimeout: () => {
    const { lastActivity, sessionTimeout, privateKey } = get()
    if (!privateKey || !lastActivity) return false

    if (Date.now() - lastActivity >= sessionTimeout) {
      // Auto-lock after timeout
      set({ privateKey: null, publicKey: null })
      return true
    }
    return false
  },
}))

/**
 * Hook to access vault key functionality.
 */
export function useVaultKey() {
  const store = useVaultKeyStore()

  return {
    isUnlocked: store.isUnlocked(),
    hasKeys: !!store.privateKey,
    setKeys: store.setKeys,
    clearKeys: store.clearKeys,
    updateActivity: store.updateActivity,
    getPrivateKey: () => {
      store.checkTimeout()
      store.updateActivity()
      return store.privateKey
    },
    getPublicKey: () => {
      store.checkTimeout()
      store.updateActivity()
      return store.publicKey
    },
  }
}

// Keep backward-compatible alias
export const useMasterPasswordStore = useVaultKeyStore
export function useMasterPassword() {
  const vaultKey = useVaultKey()
  return {
    isUnlocked: vaultKey.isUnlocked,
    hasPassword: vaultKey.hasKeys,
    setPassword: async () => {}, // no-op for compatibility
    clearPassword: vaultKey.clearKeys,
    verifyPassword: async () => vaultKey.hasKeys,
    updateActivity: vaultKey.updateActivity,
    getMasterPassword: () => null as string | null, // deprecated
  }
}
