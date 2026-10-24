/**
 * Locking the vault: the Lock button on the Credentials page, and the
 * auto-lock that drops the key from memory once the timeout passes even if
 * nothing touches the key.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

vi.mock('@/services/credentialService', () => ({
  credentialService: { list: vi.fn() },
}))

import CredentialsPage from '@/pages/CredentialsPage'
import { credentialService } from '@/services/credentialService'
import { AUTO_LOCK_CHECK_MS, useAutoLock } from '@/hooks/useVaultLock'
import { useVaultKeyStore } from '@/hooks/useVaultKey'
import { useAuthStore } from '@/stores/authStore'
import type { User } from '@/types'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

async function render(ui: React.ReactNode) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () =>
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>{ui}</MemoryRouter>
      </QueryClientProvider>
    )
  )
}

function AutoLock() {
  useAutoLock()
  return null
}

describe('locking the vault', () => {
  beforeEach(() => {
    vi.mocked(credentialService.list).mockReset().mockResolvedValue([])
    useAuthStore.setState({ user: { id: 'u1', has_vault_keys: true } as User })
    useVaultKeyStore.getState().setKeys({} as CryptoKey, {} as CryptoKey, 'pk')
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    useVaultKeyStore.getState().clearKeys()
    vi.useRealTimers()
  })

  it('locks from the button next to Backup on the Credentials page', async () => {
    await render(<CredentialsPage />)
    const lock = container.querySelector<HTMLButtonElement>('button[title="Lock the vault now"]')!
    expect(lock.previousElementSibling?.getAttribute('title')).toBe('Backup / Restore')

    await act(async () => lock.click())

    expect(useVaultKeyStore.getState().privateKey).toBeNull()
    expect(container.textContent).toContain('Vault Locked')
  })

  it('drops the key from memory once the auto-lock timeout has passed', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const { sessionTimeout } = useVaultKeyStore.getState()
    useVaultKeyStore.setState({ lastActivity: Date.now() - sessionTimeout - 1 })
    await render(<AutoLock />)
    expect(useVaultKeyStore.getState().privateKey).not.toBeNull()

    await act(async () => vi.advanceTimersByTime(AUTO_LOCK_CHECK_MS))

    expect(useVaultKeyStore.getState().privateKey).toBeNull()
  })
})
