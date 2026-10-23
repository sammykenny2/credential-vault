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

export const useAuthStore = create<AuthState>()((set) => ({
  user: null,
  accessToken: null,
  isAuthenticated: false,
  isBootstrapping: true,

  setAccessToken: (accessToken) => set({ accessToken, isAuthenticated: true }),

  setUser: (user) => set({ user }),

  finishBootstrap: () => set({ isBootstrapping: false }),

  logout: () => {
    useVaultKeyStore.getState().clearKeys()
    set({ user: null, accessToken: null, isAuthenticated: false })
  },
}))
