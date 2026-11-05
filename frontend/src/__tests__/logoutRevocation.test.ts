/**
 * Logging out has to end the session on the server, not just on this device.
 *
 * An access token lasts minutes and the refresh cookie days, so a session left
 * idle reaches logout with an expired token. Refused there, the cookie would
 * restore the session on the next page load.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import axios, { AxiosError, type AxiosRequestConfig, type InternalAxiosRequestConfig } from 'axios'
import { OperationCancelledError } from '@/lib/operationGuard'
import { authService } from '@/services/authService'
import { useAuthStore } from '@/stores/authStore'
import type { User } from '@/types'

const OWNER = { id: 'synthetic-owner' } as User

function refused(status: number) {
  const config = {} as InternalAxiosRequestConfig
  return new AxiosError('Refused', 'ERR_BAD_REQUEST', config, null, {
    data: {}, status, statusText: '', headers: {}, config,
  })
}

const signInAgain = () =>
  useAuthStore.setState({ accessToken: 'new-session', user: OWNER, isAuthenticated: true })

/** A server that accepts one bearer token and hands `refreshTo` out for the cookie. */
function serve({ accepts, refreshTo, refreshAs = OWNER.id, logoutFailure, during }: {
  accepts: string
  refreshTo?: string
  refreshAs?: string
  logoutFailure?: Error
  during?: (route: 'logout' | 'refresh') => void
}) {
  const calls: string[] = []
  vi.spyOn(axios, 'post').mockImplementation(async (url: string, _body, config?: AxiosRequestConfig) => {
    if (url.endsWith('/auth/refresh')) {
      calls.push('refresh')
      during?.('refresh')
      if (!refreshTo) throw refused(401)
      return { data: { access_token: refreshTo, user_id: refreshAs } }
    }
    const authorization = String(config?.headers?.Authorization)
    calls.push(`logout ${authorization}`)
    during?.('logout')
    if (logoutFailure) throw logoutFailure
    if (authorization !== `Bearer ${accepts}`) throw refused(401)
    return { data: {} }
  })
  return calls
}

beforeEach(() => {
  useAuthStore.setState({ accessToken: 'expired', user: OWNER, isAuthenticated: true })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  useAuthStore.getState().logout()
})

describe('authService.logout', () => {
  it('needs one request while the access token still works', async () => {
    const calls = serve({ accepts: 'expired' })

    await authService.logout()

    expect(calls).toEqual(['logout Bearer expired'])
  })

  it('exchanges the refresh cookie when the access token has expired', async () => {
    const calls = serve({ accepts: 'fresh', refreshTo: 'fresh' })

    await authService.logout()

    expect(calls).toEqual(['logout Bearer expired', 'refresh', 'logout Bearer fresh'])
  })

  it('keeps this device signed out while it does', async () => {
    serve({ accepts: 'fresh', refreshTo: 'fresh' })
    const pending = authService.logout()

    expect(useAuthStore.getState().isAuthenticated).toBe(false)
    await pending

    expect(useAuthStore.getState()).toMatchObject({ accessToken: null, user: null, isAuthenticated: false })
  })

  it('does not end another account that now owns the cookie', async () => {
    const calls = serve({ accepts: 'other', refreshTo: 'other', refreshAs: 'synthetic-other-account' })

    await expect(authService.logout()).rejects.toBeInstanceOf(AxiosError)

    expect(calls).toEqual(['logout Bearer expired', 'refresh'])
  })

  it('reports a session it could not exchange, since others may still be alive', async () => {
    const calls = serve({ accepts: 'never' })

    await expect(authService.logout()).rejects.toBeInstanceOf(AxiosError)

    expect(calls).toEqual(['logout Bearer expired', 'refresh'])
  })

  it('stops after one retry', async () => {
    const calls = serve({ accepts: 'never', refreshTo: 'fresh' })

    await expect(authService.logout()).rejects.toBeInstanceOf(AxiosError)

    expect(calls).toEqual(['logout Bearer expired', 'refresh', 'logout Bearer fresh'])
  })

  it.each([
    ['a server error', refused(500)],
    ['a lost connection', new Error('Network Error')],
  ])('does not spend the refresh token on %s', async (_name, logoutFailure) => {
    const calls = serve({ accepts: 'expired', refreshTo: 'fresh', logoutFailure })

    await expect(authService.logout()).rejects.toBe(logoutFailure)

    expect(calls).toEqual(['logout Bearer expired'])
  })

  it('takes the same lock as other refreshes, because each token is accepted once', async () => {
    const request = vi.fn((_name: string, exchange: () => unknown) => Promise.resolve(exchange()))
    vi.stubGlobal('navigator', { ...navigator, locks: { request } })
    serve({ accepts: 'fresh', refreshTo: 'fresh' })

    await authService.logout()

    expect(request).toHaveBeenCalledOnce()
    expect(request.mock.calls[0][0]).toBe('credential-vault:refresh')
  })

  it('sends the cookie with every request, including across origins in development', async () => {
    serve({ accepts: 'fresh', refreshTo: 'fresh' })

    await authService.logout()

    const sent = vi.mocked(axios.post).mock.calls.map(([, , config]) => config?.withCredentials)
    expect(sent).toEqual([true, true, true])
  })
})

describe('authService.logout after signing in again', () => {
  it('does not spend the cookie of a sign-in that arrived while it waited for the lock', async () => {
    let takeTurn = () => {}
    const turn = new Promise<void>((resolve) => { takeTurn = resolve })
    const request = vi.fn(async (_name: string, exchange: () => unknown) => {
      await turn
      return exchange()
    })
    vi.stubGlobal('navigator', { ...navigator, locks: { request } })
    const calls = serve({ accepts: 'fresh', refreshTo: 'fresh' })

    const pending = authService.logout()
    await vi.waitFor(() => expect(request).toHaveBeenCalledOnce())
    signInAgain()
    takeTurn()

    await expect(pending).rejects.toBeInstanceOf(OperationCancelledError)
    expect(calls).toEqual(['logout Bearer expired'])
  })

  it('does not end a sign-in that arrived during the exchange', async () => {
    const calls = serve({
      accepts: 'fresh',
      refreshTo: 'fresh',
      during: (route) => { if (route === 'refresh') signInAgain() },
    })

    await expect(authService.logout()).rejects.toBeInstanceOf(OperationCancelledError)

    expect(calls).toEqual(['logout Bearer expired', 'refresh'])
  })

  it('does not report the old failure to the new session', async () => {
    const calls = serve({
      accepts: 'expired',
      logoutFailure: refused(500),
      during: signInAgain,
    })

    await expect(authService.logout()).rejects.toBeInstanceOf(OperationCancelledError)

    expect(calls).toEqual(['logout Bearer expired'])
    expect(useAuthStore.getState().accessToken).toBe('new-session')
  })
})
