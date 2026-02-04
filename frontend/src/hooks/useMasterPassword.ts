/**
 * React hook for managing the master password.
 *
 * The master password is stored in memory only and never sent to the server.
 * It's used to encrypt/decrypt credentials client-side.
 */

import { create } from 'zustand'
import { sha256 } from '@/lib/crypto'

interface MasterPasswordState {
  // Hash of master password (for verification without storing plaintext)
  passwordHash: string | null
  // Master password in memory (cleared on logout/timeout)
  masterPassword: string | null
  // Timestamp when password was last entered
  lastActivity: number | null
  // Session timeout in milliseconds (default: 15 minutes)
  sessionTimeout: number

  // Actions
  setMasterPassword: (password: string) => Promise<void>
  clearMasterPassword: () => void
  verifyMasterPassword: (password: string) => Promise<boolean>
  isUnlocked: () => boolean
  updateActivity: () => void
  checkTimeout: () => boolean
}

export const useMasterPasswordStore = create<MasterPasswordState>((set, get) => ({
  passwordHash: null,
  masterPassword: null,
  lastActivity: null,
  sessionTimeout: 15 * 60 * 1000, // 15 minutes

  setMasterPassword: async (password: string) => {
    const hash = await sha256(password)
    set({
      passwordHash: hash,
      masterPassword: password,
      lastActivity: Date.now(),
    })
  },

  clearMasterPassword: () => {
    set({
      masterPassword: null,
      lastActivity: null,
    })
  },

  verifyMasterPassword: async (password: string) => {
    const { passwordHash } = get()
    if (!passwordHash) return false
    const hash = await sha256(password)
    return hash === passwordHash
  },

  isUnlocked: () => {
    const { masterPassword, lastActivity, sessionTimeout } = get()
    if (!masterPassword || !lastActivity) return false
    return Date.now() - lastActivity < sessionTimeout
  },

  updateActivity: () => {
    set({ lastActivity: Date.now() })
  },

  checkTimeout: () => {
    const { lastActivity, sessionTimeout, masterPassword } = get()
    if (!masterPassword || !lastActivity) return false

    if (Date.now() - lastActivity >= sessionTimeout) {
      // Auto-lock after timeout
      set({ masterPassword: null })
      return true
    }
    return false
  },
}))

/**
 * Hook to access master password functionality.
 */
export function useMasterPassword() {
  const store = useMasterPasswordStore()

  return {
    isUnlocked: store.isUnlocked(),
    hasPassword: !!store.passwordHash,
    setPassword: store.setMasterPassword,
    clearPassword: store.clearMasterPassword,
    verifyPassword: store.verifyMasterPassword,
    updateActivity: store.updateActivity,
    getMasterPassword: () => {
      store.checkTimeout()
      store.updateActivity()
      return store.masterPassword
    },
  }
}
