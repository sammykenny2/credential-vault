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

const getStatus = vi.mocked(setupService.getStatus)

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

async function renderLogin() {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={['/login']}>
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
    useAuthStore.setState({ isBootstrapping: false, isAuthenticated: false })
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('says the first Google sign-in becomes the administrator', async () => {
    getStatus.mockResolvedValue({ is_initialized: false })
    await renderLogin()

    await waitForText('Sign in with Google')
    expect(container.textContent).toContain('No administrator yet')
    expect(container.querySelector('a[href="/admin/setup"]')).not.toBeNull()
  })

  it('shows only the sign-in once an admin exists', async () => {
    getStatus.mockResolvedValue({ is_initialized: true })
    await renderLogin()

    await waitForText('Sign in with Google')
    expect(container.textContent).not.toContain('No administrator yet')
  })

  it('waits for the backend instead of showing the sign-in when the check fails', async () => {
    getStatus
      .mockRejectedValueOnce(new Error('Request failed with status code 502'))
      .mockResolvedValue({ is_initialized: false })
    await renderLogin()

    await waitForText('Waiting for the server to start')
    expect(container.textContent).not.toContain('Sign in with Google')

    await waitForText('No administrator yet')
    expect(getStatus).toHaveBeenCalledTimes(2)
  })
})
