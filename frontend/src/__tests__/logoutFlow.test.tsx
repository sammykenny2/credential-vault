/**
 * Logout through the real App: click Logout, end up on a login page that tells
 * the truth.
 *
 * Signing out locally redirects before the server answers, so the login page is
 * already up when a failure arrives. A session the server never revoked must not
 * look like a clean logout: the next page load would restore it.
 */

import { StrictMode, act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios'

vi.mock('@/pages/DashboardPage', () => ({ default: () => <div>Dashboard</div> }))
vi.mock('@/components/VersionInfo', () => ({ default: () => null }))
vi.mock('@/components/OfflineIndicator', () => ({ default: () => null }))
vi.mock('@/services/setupService', () => ({ setupService: { getStatus: vi.fn() } }))

import App from '@/App'
import { authService } from '@/services/authService'
import { setupService } from '@/services/setupService'
import { useAuthStore } from '@/stores/authStore'
import type { User } from '@/types'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const OWNER = { id: 'synthetic-owner', display_name: 'Owner', role: 'user' } as unknown as User
const WARNING = 'could not confirm session revocation'

function refused(status: number) {
  const config = {} as InternalAxiosRequestConfig
  return new AxiosError('Refused', 'ERR_BAD_REQUEST', config, null, {
    data: {}, status, statusText: '', headers: {}, config,
  })
}

/** Scripted statuses. The first refresh restores the session when the page loads. */
function serve({ logout, refresh = [], logoutDelayMs = 10 }: {
  logout: number[]
  refresh?: number[]
  logoutDelayMs?: number
}) {
  const replies = { logout: [...logout], refresh: [200, ...refresh] }
  vi.spyOn(axios, 'post').mockImplementation(async (url: string) => {
    const route = url.endsWith('/auth/logout') ? 'logout' : 'refresh'
    await new Promise((resolve) => setTimeout(resolve, route === 'logout' ? logoutDelayMs : 10))
    const status = replies[route].shift()
    if (status !== 200) throw refused(status ?? 500)
    return { data: { access_token: 'synthetic-token', user_id: OWNER.id } }
  })
}

let container: HTMLDivElement
let root: Root

async function waitUntil(condition: () => boolean, describeWait: string) {
  const start = Date.now()
  while (!condition()) {
    if (Date.now() - start > 5000) {
      throw new Error(`Never saw ${describeWait}; at ${window.location.pathname}: ${container.textContent}`)
    }
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)) })
  }
}

const shows = (text: string) => container.textContent?.includes(text) ?? false

async function openDashboard() {
  window.history.pushState({}, '', '/dashboard')
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root.render(
      <StrictMode>
        <QueryClientProvider client={new QueryClient()}>
          <BrowserRouter><App /></BrowserRouter>
        </QueryClientProvider>
      </StrictMode>
    )
  })
  await waitUntil(() => shows('Dashboard'), 'the dashboard')
}

async function clickLogout() {
  const button = [...container.querySelectorAll('button')].find((b) => b.textContent?.includes('Logout'))
  await act(async () => { button?.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  await waitUntil(() => shows('Sign in with Google'), 'the login page')
}

async function goToPasswordSignIn() {
  const link = container.querySelector('a[href="/admin/login"]')
  await act(async () => {
    link?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }))
  })
  expect(window.location.pathname).toBe('/admin/login')
}

/** Long enough for any outstanding logout to have landed. */
async function settle() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 250)) })
}

beforeEach(() => {
  vi.mocked(setupService.getStatus).mockResolvedValue({ is_initialized: true, can_create_admin: false })
  vi.spyOn(authService, 'getMe').mockResolvedValue(OWNER)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.restoreAllMocks()
  useAuthStore.getState().logout()
})

describe('a logout the server did not confirm', () => {
  it.each([
    ['the request fails', { logout: [500] }],
    ['the session cannot be exchanged', { logout: [401], refresh: [401] }],
    ['the retry fails', { logout: [401, 500], refresh: [200] }],
  ])('warns on the login page when %s', async (_name, script) => {
    serve(script)
    await openDashboard()

    await clickLogout()
    await waitUntil(() => shows(WARNING), 'the warning')

    expect(window.location.pathname).toBe('/login')
    expect(shows('Sign in with Google')).toBe(true)
  })

  it('does not repeat the warning after a reload', async () => {
    serve({ logout: [500] })
    await openDashboard()

    await clickLogout()
    await waitUntil(() => shows(WARNING), 'the warning')
    await waitUntil(() => !window.history.state?.usr, 'history cleared')
  })

  it('still warns a user who already moved on to the password page', async () => {
    serve({ logout: [500], logoutDelayMs: 100 })
    await openDashboard()

    await clickLogout()
    await goToPasswordSignIn()
    await waitUntil(() => shows(WARNING), 'the warning')

    expect(window.location.pathname).toBe('/login')
  })
})

describe('a logout the server confirmed', () => {
  it('says nothing', async () => {
    serve({ logout: [200] })
    await openDashboard()

    await clickLogout()
    await settle()

    expect(window.location.pathname).toBe('/login')
    expect(shows(WARNING)).toBe(false)
  })

  it('does not pull a user back from the password page', async () => {
    serve({ logout: [200], logoutDelayMs: 100 })
    await openDashboard()

    await clickLogout()
    await goToPasswordSignIn()
    await settle()

    expect(window.location.pathname).toBe('/admin/login')
  })
})

describe('signing in again before the logout finishes', () => {
  it('leaves the new session where it is', async () => {
    serve({ logout: [500], logoutDelayMs: 100 })
    await openDashboard()

    await clickLogout()
    await act(async () => {
      useAuthStore.setState({ accessToken: 'new-session', user: OWNER, isAuthenticated: true })
    })
    await waitUntil(() => window.location.pathname === '/dashboard', 'the dashboard again')
    const entries = window.history.length
    await settle()

    expect(window.location.pathname).toBe('/dashboard')
    expect(window.history.length).toBe(entries)
  })
})
