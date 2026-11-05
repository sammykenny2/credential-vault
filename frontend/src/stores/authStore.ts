import { create } from 'zustand'
import type { User } from '@/types'
import { useVaultKeyStore } from '@/hooks/useVaultKey'

/**
 * Session state.
 *
 * The access token lives only in memory. The refresh token is an HttpOnly
 * cookie managed by the server, so nothing auth-related is written to
 * localStorage where an XSS payload could read it. On page load App.tsx
 * performs a silent refresh to restore the session; `isBootstrapping` stays
 * true until that attempt settles.
 */
interface AuthState {
  user: User | null
  accessToken: string | null
  isAuthenticated: boolean
  isBootstrapping: boolean
  generation: number
  vaultSetupToken: string | null
  setVaultSetupToken: (token: string | null) => void

  setAccessToken: (accessToken: string) => void
  setUser: (user: User) => void
  finishBootstrap: () => void
  /** Clear local session state and the in-memory vault keys. */
  logout: () => void
}

// Older builds persisted tokens under this key; make sure nothing lingers.
try {
  localStorage.removeItem('auth-storage')
} catch {
  // Storage unavailable (private mode, etc.): nothing to clean up.
}

function tokenIdentity(token: string): string | null {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    return JSON.stringify([payload.sub, payload.sid, payload.ver])
  } catch { return null }
}

export const useAuthStore = create<AuthState>()((set, get) => ({
  user: null,
  accessToken: null,
  isAuthenticated: false,
  isBootstrapping: true,
  generation: 0,
  vaultSetupToken: null,
  setVaultSetupToken: (vaultSetupToken) => set({ vaultSetupToken }),

  setAccessToken: (accessToken) => {
    const previous = get().accessToken
    // Claims here only detect a change; API authentication still validates the JWT.
    if (previous && previous !== accessToken &&
        (!tokenIdentity(previous) || tokenIdentity(previous) !== tokenIdentity(accessToken))) {
      useVaultKeyStore.getState().clearKeys()
      set({ user: null, accessToken, vaultSetupToken: null, isAuthenticated: true, generation: get().generation + 1 })
    } else {
      set({ accessToken, isAuthenticated: true })
    }
  },

  setUser: (user) => {
    if (get().user?.id !== user.id) {
      useVaultKeyStore.getState().clearKeys()
      set({ user, generation: get().generation + 1 })
    } else {
      set({ user })
    }
  },

  finishBootstrap: () => set({ isBootstrapping: false }),

  logout: () => {
    useVaultKeyStore.getState().clearKeys()
    set({ user: null, accessToken: null, vaultSetupToken: null, isAuthenticated: false, generation: get().generation + 1 })
  },
}))
