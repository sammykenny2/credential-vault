import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import axios, { AxiosError, type AxiosAdapter, type InternalAxiosRequestConfig } from 'axios'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { useOperationGuard } from '@/hooks/useOperationGuard'
import api, { refreshAccessToken } from '@/services/api'
import { useAuthStore } from '@/stores/authStore'
import { useVaultKeyStore } from '@/hooks/useVaultKey'
import { captureOperation, OperationCancelledError } from '@/lib/operationGuard'
import type { User } from '@/types'

const initialAdapter = axios.defaults.adapter
const initialApiAdapter = api.defaults.adapter
const user = { id: 'synthetic-owner' } as User

function token(sid: string) {
  return `e30.${btoa(JSON.stringify({ sub: user.id, sid, ver: 0 }))}.synthetic`
}

beforeEach(() => {
  useAuthStore.getState().logout()
  useAuthStore.getState().setAccessToken(token('family-a'))
  useAuthStore.getState().setUser(user)
})
afterEach(() => {
  axios.defaults.adapter = initialAdapter
  api.defaults.adapter = initialApiAdapter
  vi.restoreAllMocks()
  useAuthStore.getState().logout()
})

function delayedAdapter() {
  let resolve!: (value: { data: unknown; status: number; statusText: string; headers: object; config: InternalAxiosRequestConfig }) => void
  let config!: InternalAxiosRequestConfig
  const adapter: AxiosAdapter = (request) => {
    config = request
    return new Promise((done) => { resolve = done })
  }
  return { adapter, resolve: (data: unknown) => resolve({ data, status: 200, statusText: 'OK', headers: {}, config }),
    started: () => Boolean(config) }
}

describe('asynchronous session boundaries', () => {
  it('does not retry a rate-limited write after its dialog closes', async () => {
    vi.useFakeTimers()
    try {
      const operation = captureOperation(false)
      const adapter = vi.fn<AxiosAdapter>(async (config) => {
        throw new AxiosError('rate limited', 'ERR_BAD_REQUEST', config, undefined, {
          config, status: 429, statusText: 'Too Many Requests', headers: { 'retry-after': '1' }, data: {},
        })
      })
      api.defaults.adapter = adapter
      const result = expect(api.post('/credentials/', {}, { assertOperation: operation.assertActive }))
        .rejects.toBeInstanceOf(OperationCancelledError)
      await vi.advanceTimersByTimeAsync(0)
      expect(adapter).toHaveBeenCalledTimes(1)
      operation.cancel()
      await vi.advanceTimersByTimeAsync(1000)
      await result
      expect(adapter).toHaveBeenCalledTimes(1)
    } finally { vi.useRealTimers() }
  })

  it('releases completed and locked-operation key references while a page stays mounted', async () => {
    const container = document.createElement('div')
    const root = createRoot(container)
    let guard!: ReturnType<typeof useOperationGuard>
    function Page() { guard = useOperationGuard(); return null }
    await act(async () => { root.render(createElement(Page)) })
    try {
      useVaultKeyStore.getState().setKeys({} as CryptoKey, {} as CryptoKey, 'synthetic', {} as never)
      const completed = guard.begin()
      expect(completed.vault.privateKey).not.toBeNull()
      completed.finish()
      expect(completed.vault.privateKey).toBeNull()
      expect(completed.vault.signer).toBeNull()
      const pending = guard.begin()
      useVaultKeyStore.getState().clearKeys()
      expect(pending.vault.privateKey).toBeNull()
      expect(pending.vault.signer).toBeNull()
      expect(pending.assertActive).toThrow(OperationCancelledError)
    } finally { await act(async () => { root.unmount() }) }
  })

  it('does not restore authentication from a refresh that finishes after logout', async () => {
    const delayed = delayedAdapter()
    axios.defaults.adapter = delayed.adapter
    const result = expect(refreshAccessToken()).rejects.toBeInstanceOf(OperationCancelledError)
    await vi.waitFor(() => expect(delayed.started()).toBe(true))
    useAuthStore.getState().logout()
    delayed.resolve({ access_token: token('family-a'), user_id: user.id })
    await result
    expect(useAuthStore.getState().isAuthenticated).toBe(false)
  })

  it('rejects refresh for another cookie owner', async () => {
    const delayed = delayedAdapter()
    axios.defaults.adapter = delayed.adapter
    const result = expect(refreshAccessToken()).rejects.toBeInstanceOf(OperationCancelledError)
    await vi.waitFor(() => expect(delayed.started()).toBe(true))
    delayed.resolve({ access_token: token('family-b'), user_id: 'different-owner' })
    await result
    expect(useAuthStore.getState().user).toBeNull()
  })

  it('rejects responses from the previous account', async () => {
    const delayed = delayedAdapter()
    api.defaults.adapter = delayed.adapter
    const result = expect(api.get('/credentials/')).rejects.toBeInstanceOf(OperationCancelledError)
    await vi.waitFor(() => expect(delayed.started()).toBe(true))
    useAuthStore.getState().logout()
    useAuthStore.getState().setUser({ ...user, id: 'another-owner' })
    delayed.resolve([])
    await result
  })

  it('invalidates old operations when a different session token arrives before getMe', () => {
    const operation = captureOperation(false)
    useAuthStore.getState().setAccessToken(token('family-b'))
    expect(operation.assertActive).toThrow(OperationCancelledError)
    expect(useAuthStore.getState().user).toBeNull()
  })

  it('invalidates a pending unlock even when clearKeys is called while already locked', () => {
    const operation = captureOperation(false)
    useVaultKeyStore.getState().clearKeys()
    expect(operation.assertActive).toThrow(OperationCancelledError)
  })
})
