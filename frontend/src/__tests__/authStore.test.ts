/**
 * Session store tests: tokens stay in memory, logout clears vault keys.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { useAuthStore } from '@/stores/authStore'
import { useVaultKeyStore } from '@/hooks/useVaultKey'

const fakeKey = {} as CryptoKey

describe('authStore', () => {
  beforeEach(() => {
    useAuthStore.getState().logout()
    useAuthStore.setState({ isBootstrapping: true })
    localStorage.clear()
  })

  it('starts bootstrapping and signed out', () => {
    const state = useAuthStore.getState()
    expect(state.isBootstrapping).toBe(true)
    expect(state.isAuthenticated).toBe(false)
    expect(state.accessToken).toBeNull()
  })

  it('setAccessToken marks the session authenticated without persisting anything', () => {
    useAuthStore.getState().setAccessToken('access-123')
    const state = useAuthStore.getState()
    expect(state.isAuthenticated).toBe(true)
    expect(state.accessToken).toBe('access-123')
    expect(localStorage.getItem('auth-storage')).toBeNull()
    expect(localStorage.length).toBe(0)
  })

  it('finishBootstrap clears the bootstrapping flag', () => {
    useAuthStore.getState().finishBootstrap()
    expect(useAuthStore.getState().isBootstrapping).toBe(false)
  })

  it('logout clears session state and the in-memory vault keys', () => {
    useAuthStore.getState().setAccessToken('access-123')
    useAuthStore.getState().setUser({
      id: 'u1',
      email: 'u@example.com',
      display_name: 'U',
      role: 'user',
      has_vault_keys: true,
      has_google_linked: true,
      has_password: false,
      is_active: true,
      created_at: '2026-01-01T00:00:00Z',
      last_login_at: null,
    })
    useVaultKeyStore.getState().setKeys(fakeKey, fakeKey, 'pub')
    expect(useVaultKeyStore.getState().privateKey).not.toBeNull()

    useAuthStore.getState().logout()

    const state = useAuthStore.getState()
    expect(state.isAuthenticated).toBe(false)
    expect(state.accessToken).toBeNull()
    expect(state.user).toBeNull()
    expect(useVaultKeyStore.getState().privateKey).toBeNull()
    expect(useVaultKeyStore.getState().publicKey).toBeNull()
  })
})
