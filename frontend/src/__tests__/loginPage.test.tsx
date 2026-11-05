/**
 * LoginPage on a vault without an admin.
 *
 * The first Google sign-in becomes the admin (app/api/v1/oauth.py), so the
 * page says so instead of forcing /admin/setup. It must not show the sign-in
 * button before it knows whether an admin exists: right after a deploy the
 * backend answers 502 for a few seconds, and the page used to fall back to a
 * plain sign-in page then.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

vi.mock('@/services/setupService', () => ({
  setupService: { getStatus: vi.fn(), createAdmin: vi.fn() },
}))

import LoginPage from '@/pages/LoginPage'
import { setupService } from '@/services/setupService'
import { useAuthStore } from '@/stores/authStore'
import { authService } from '@/services/authService'
import { beginOAuthFlow, peekOAuthFlow, clearOAuthFlow } from '@/lib/oauthState'
import type { User } from '@/types'

const getStatus = vi.mocked(setupService.getStatus)

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

async function renderLogin(path = '/login') {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={[path]}>
          <LoginPage />
        </MemoryRouter>
      </QueryClientProvider>
    )
  })
}

async function waitForText(text: string, timeout = 5000) {
  const start = Date.now()
  while (!container.textContent?.includes(text)) {
    if (Date.now() - start > timeout) {
      throw new Error(`"${text}" never appeared; the page says: ${container.textContent}`)
    }
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
    })
  }
}

describe('LoginPage first run', () => {
  beforeEach(() => {
    getStatus.mockReset()
    useAuthStore.getState().logout()
    clearOAuthFlow()
    useAuthStore.setState({ isBootstrapping: false, isAuthenticated: false })
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.restoreAllMocks()
    clearOAuthFlow()
  })

  it('offers a password sign-in, the only way back for a password-only admin', async () => {
    getStatus.mockResolvedValue({ is_initialized: true, can_create_admin: false })
    await renderLogin()

    await waitForText('Sign in with Google')
    expect(container.querySelector('a[href="/admin/login"]')).not.toBeNull()
  })

  it.each([
    ['anyone can still create one', true],
    ['setup is restricted', false],
  ])('hides the password sign-in while there is no administrator and %s', async (_name, can_create_admin) => {
    getStatus.mockResolvedValue({ is_initialized: false, can_create_admin })
    await renderLogin()

    await waitForText('Sign in with Google')
    expect(container.querySelector('a[href="/admin/login"]')).toBeNull()
  })

  it('hides the password sign-in when a failed callback leaves it unknown whether an admin exists', async () => {
    await renderLogin('/login?code=synthetic-code&state=not-from-this-tab')

    await waitForText('Sign in with Google')
    expect(getStatus).not.toHaveBeenCalled()
    expect(container.querySelector('a[href="/admin/login"]')).toBeNull()
  })

  it('says the first Google sign-in becomes the administrator', async () => {
    getStatus.mockResolvedValue({ is_initialized: false, can_create_admin: true })
    await renderLogin()

    await waitForText('Sign in with Google')
    expect(container.textContent).toContain('No administrator yet')
    expect(container.querySelector('a[href="/admin/setup"]')).not.toBeNull()
  })

  it('waits for session bootstrap before consuming a Google linking callback', async () => {
    useAuthStore.setState({ isBootstrapping: true })
    const state = beginOAuthFlow('link', 'synthetic-link-authorization')
    const user = { id: 'synthetic-owner', has_google_linked: true } as User
    const link = vi.spyOn(authService, 'linkGoogleAccount').mockResolvedValue(user)
    await renderLogin(`/login?code=synthetic-code&state=${state}`)
    expect(link).not.toHaveBeenCalled()
    expect(peekOAuthFlow()?.action).toBe('link')
    await act(async () => {
      useAuthStore.setState({ isAuthenticated: true })
      useAuthStore.getState().setUser(user)
    })
    expect(link).not.toHaveBeenCalled()
    await act(async () => { useAuthStore.getState().finishBootstrap() })
    expect(link).toHaveBeenCalledTimes(1)
    expect(link).toHaveBeenCalledWith(expect.objectContaining({ link_token: 'synthetic-link-authorization' }))
    expect(peekOAuthFlow()).toBeNull()
  })

  it('shows only the sign-in once an admin exists', async () => {
    getStatus.mockResolvedValue({ is_initialized: true, can_create_admin: false })
    await renderLogin()

    await waitForText('Sign in with Google')
    expect(container.textContent).not.toContain('No administrator yet')
  })

  it('waits for the backend instead of showing the sign-in when the check fails', async () => {
    getStatus
      .mockRejectedValueOnce(new Error('Request failed with status code 502'))
      .mockResolvedValue({ is_initialized: false, can_create_admin: true })
    await renderLogin()

    await waitForText('Waiting for the server to start')
    expect(container.textContent).not.toContain('Sign in with Google')

    await waitForText('No administrator yet')
    expect(getStatus).toHaveBeenCalledTimes(2)
  })
})
