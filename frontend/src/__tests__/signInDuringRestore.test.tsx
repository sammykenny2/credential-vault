/**
 * Signing in while the page load is still restoring a session, through the real App.
 *
 * Every page load first tries the refresh cookie, and on a slow server finding no
 * session there can take seconds. That must not cancel a sign-in, or the first-run
 * setup check, already on its way. Coming back from Google brings its own session,
 * so that page load does not try the cookie at all.
 */

import { StrictMode, act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import axios, { AxiosError, type AxiosAdapter, type InternalAxiosRequestConfig } from 'axios'

vi.mock('@/pages/DashboardPage', () => ({ default: () => <div>Dashboard</div> }))
vi.mock('@/components/VersionInfo', () => ({ default: () => null }))
vi.mock('@/components/OfflineIndicator', () => ({ default: () => null }))

import App from '@/App'
import api from '@/services/api'
import { authService } from '@/services/authService'
import { beginOAuthFlow, clearOAuthFlow } from '@/lib/oauthState'
import { useAuthStore } from '@/stores/authStore'
import type { User } from '@/types'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const OWNER = { id: 'synthetic-owner', display_name: 'Owner', role: 'user' } as unknown as User
const SESSION = { access_token: 'synthetic-token', token_type: 'bearer', expires_in: 900, user_id: OWNER.id }

let container: HTMLDivElement | undefined
let root: Root | undefined
const realAdapter = api.defaults.adapter

function heldReply() {
  let release = () => {}
  const held = new Promise<void>((resolve) => { release = resolve })
  return { held, release }
}

/** The page-load restore. 401: this browser holds no session the server still accepts. */
function serveRestore(status: 200 | 401, held?: Promise<void>) {
  vi.spyOn(axios, 'post').mockImplementation(async () => {
    await held
    if (status === 200) return { data: { access_token: 'restored-token', user_id: OWNER.id } }
    const config = {} as InternalAxiosRequestConfig
    throw new AxiosError('Refused', 'ERR_BAD_REQUEST', config, null, {
      data: {}, status, statusText: '', headers: {}, config,
    })
  })
}

/** API replies by path, each kept back until its `held` resolves. */
function answer(routes: Record<string, { data: unknown; held: Promise<void> }>) {
  const adapter = vi.fn<AxiosAdapter>(async (config) => {
    const route = Object.entries(routes).find(([path]) => config.url?.endsWith(path))
    if (!route) throw new Error(`Unexpected ${config.url}`)
    await route[1].held
    return { data: route[1].data, status: 200, statusText: 'OK', headers: {}, config }
  })
  api.defaults.adapter = adapter
  return adapter
}

async function waitUntil(condition: () => boolean, describeWait: string) {
  const start = Date.now()
  while (!condition()) {
    if (Date.now() - start > 3000) {
      throw new Error(`Never saw ${describeWait}; at ${window.location.pathname}: ${container?.textContent}`)
    }
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)) })
  }
}

/** Long enough for anything already answered to have been handled. */
async function settle() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 250)) })
}

const shows = (text: string) => container?.textContent?.includes(text) ?? false
const restoreAttempts = () => vi.mocked(axios.post).mock.calls.length

async function openApp(path: string) {
  window.history.pushState({}, '', path)
  container = document.createElement('div')
  document.body.appendChild(container)
  const page = root = createRoot(container)
  await act(async () => {
    page.render(
      <StrictMode>
        <QueryClientProvider client={new QueryClient()}>
          <BrowserRouter><App /></BrowserRouter>
        </QueryClientProvider>
      </StrictMode>
    )
  })
}

async function typeInto(selector: string, value: string) {
  const input = container!.querySelector<HTMLInputElement>(selector)!
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  await act(async () => {
    setValue.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

beforeEach(() => {
  useAuthStore.setState({ isBootstrapping: true }) // as on every real page load
  vi.spyOn(authService, 'getMe').mockResolvedValue(OWNER)
})

afterEach(() => {
  if (root) act(() => root?.unmount())
  container?.remove()
  root = container = undefined
  window.history.replaceState({}, '', '/')
  api.defaults.adapter = realAdapter
  vi.restoreAllMocks()
  clearOAuthFlow()
  useAuthStore.getState().logout()
})

it.each([
  ['no session', 401],
  ['a session another tab signed in', 200],
] as const)('finishes a Google sign-in while the cookie holds %s, leaving it unspent', async (_, status) => {
  serveRestore(status)
  const reply = heldReply()
  const exchange = answer({ '/oauth/google/callback': { data: SESSION, held: reply.held } })

  await openApp(`/login?code=synthetic-code&state=${beginOAuthFlow('login')}`)
  await waitUntil(() => exchange.mock.calls.length === 1, 'the code exchange being sent')
  await settle()
  reply.release()

  await waitUntil(() => shows('Dashboard'), 'the dashboard')
  expect(shows('Authentication failed')).toBe(false)
  expect(useAuthStore.getState().user?.id).toBe(OWNER.id)
  expect(useAuthStore.getState().accessToken).toBe(SESSION.access_token)
  expect(exchange).toHaveBeenCalledTimes(1)
  expect(restoreAttempts()).toBe(0)
})

it('finishes a password sign-in sent before the restore found no session', async () => {
  const restore = heldReply()
  serveRestore(401, restore.held)
  const reply = heldReply()
  const login = answer({ '/auth/login': { data: SESSION, held: reply.held } })

  await openApp('/admin/login')
  await typeInto('#email', 'admin@example.test')
  await typeInto('#password', 'synthetic-password')
  const submit = container!.querySelector<HTMLButtonElement>('button[type="submit"]')!
  await act(async () => { submit.click() })
  await waitUntil(() => login.mock.calls.length === 1 && restoreAttempts() === 1, 'both requests being sent')
  restore.release()
  await settle()
  reply.release()

  await waitUntil(() => shows('Dashboard'), 'the dashboard')
  expect(shows('Login failed')).toBe(false)
  expect(useAuthStore.getState().user?.id).toBe(OWNER.id)
})

it('shows first-run setup when its check answers after the restore found no session', async () => {
  const restore = heldReply()
  serveRestore(401, restore.held)
  const reply = heldReply()
  const check = answer({
    '/setup/status': { data: { is_initialized: false, can_create_admin: true }, held: reply.held },
  })

  await openApp('/admin/setup')
  await waitUntil(() => check.mock.calls.length > 0 && restoreAttempts() === 1, 'both requests being sent')
  restore.release()
  await settle()
  reply.release()

  // The form appears either way; a cancelled check shows it under an error.
  await waitUntil(() => shows('Create your admin account'), 'the setup page')
  expect(shows('Failed to check setup status')).toBe(false)
})
