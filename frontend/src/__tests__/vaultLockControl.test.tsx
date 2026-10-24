/**
 * VaultLockControl: lock the vault on demand, and drop the key from memory
 * when the auto-lock timeout passes even if nothing touches the key.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import VaultLockControl, { AUTO_LOCK_CHECK_MS } from '@/components/VaultLockControl'
import { useVaultKeyStore } from '@/hooks/useVaultKey'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

async function render() {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () =>
    root.render(
      <MemoryRouter>
        <VaultLockControl />
      </MemoryRouter>
    )
  )
}

describe('VaultLockControl', () => {
  beforeEach(() => {
    useVaultKeyStore.getState().setKeys({} as CryptoKey, {} as CryptoKey, 'pk')
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    useVaultKeyStore.getState().clearKeys()
    vi.useRealTimers()
  })

  it('locks the vault now', async () => {
    await render()

    await act(async () => container.querySelector('button')!.click())

    expect(useVaultKeyStore.getState().privateKey).toBeNull()
    expect(container.textContent).toContain('Unlock Vault')
    expect(container.querySelector('a')!.getAttribute('href')).toBe('/credentials')
  })

  it('drops the key from memory once the auto-lock timeout has passed', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const { sessionTimeout } = useVaultKeyStore.getState()
    useVaultKeyStore.setState({ lastActivity: Date.now() - sessionTimeout - 1 })
    await render()
    expect(useVaultKeyStore.getState().privateKey).not.toBeNull()

    await act(async () => vi.advanceTimersByTime(AUTO_LOCK_CHECK_MS))

    expect(useVaultKeyStore.getState().privateKey).toBeNull()
    expect(container.textContent).toContain('Unlock Vault')
  })
})
