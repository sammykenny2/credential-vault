/**
 * AdminUsersPage: account changes carry the vault proof, and the actions stay
 * disabled while the vault is locked.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

vi.mock('@/services/userService', () => ({
  userService: { list: vi.fn(), updateRole: vi.fn(), update: vi.fn(), deactivate: vi.fn() },
}))
vi.mock('@/lib/vaultProof', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/vaultProof')>()),
  vaultProofHeaders: vi.fn(),
}))

import AdminUsersPage from '@/pages/AdminUsersPage'
import { userService } from '@/services/userService'
import { vaultProofHeaders } from '@/lib/vaultProof'
import { useAuthStore } from '@/stores/authStore'
import { useVaultKeyStore } from '@/hooks/useVaultKey'
import type { User } from '@/types'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const ADMIN = { id: 'admin-1', email: 'admin@example.com', display_name: 'Admin', role: 'admin' }
const MEMBER = { id: 'user-1', email: 'user@example.com', display_name: 'Member', role: 'user' }

let container: HTMLDivElement
let root: Root

async function render() {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () =>
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <AdminUsersPage />
        </MemoryRouter>
      </QueryClientProvider>
    )
  )
}

async function promoteButton(): Promise<HTMLButtonElement> {
  for (let attempt = 0; attempt < 50; attempt++) {
    const button = container.querySelector<HTMLButtonElement>('button[title="Promote to Admin"]')
    if (button) return button
    await act(async () => new Promise((resolve) => setTimeout(resolve, 20)))
  }
  throw new Error(`no promote button; the page says: ${container.textContent}`)
}

describe('AdminUsersPage', () => {
  beforeEach(() => {
    const row = { is_active: true, has_vault_keys: true, credential_count: 0 }
    vi.mocked(userService.list).mockReset().mockResolvedValue([
      { ...ADMIN, ...row },
      { ...MEMBER, ...row },
    ] as Awaited<ReturnType<typeof userService.list>>)
    vi.mocked(userService.updateRole).mockReset().mockResolvedValue(MEMBER as User)
    vi.mocked(vaultProofHeaders).mockReset().mockResolvedValue({ 'X-Vault-Proof': 'proof' })
    useAuthStore.setState({ user: ADMIN as User })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    useVaultKeyStore.getState().clearKeys()
    vi.restoreAllMocks()
  })

  it('disables account changes while the vault is locked', async () => {
    await render()

    const button = await promoteButton()

    expect(button.disabled).toBe(true)
    expect(container.textContent).toContain('Your vault is locked')
  })

  it('sends the vault proof with a role change', async () => {
    useVaultKeyStore.getState().setKeys({} as CryptoKey, {} as CryptoKey, 'pk')
    await render()

    const button = await promoteButton()
    expect(button.disabled).toBe(false)
    await act(async () => button.click())

    expect(userService.updateRole).toHaveBeenCalledWith('user-1', 'admin', {
      'X-Vault-Proof': 'proof',
    })
  })
})
