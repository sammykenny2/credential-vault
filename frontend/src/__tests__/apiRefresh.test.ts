import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import axios, { AxiosError, type AxiosAdapter, type InternalAxiosRequestConfig } from 'axios'
import { api } from '@/services/api'
import { authService } from '@/services/authService'
import { useAuthStore } from '@/stores/authStore'

const originalAdapter = api.defaults.adapter

function serve(accepted: string) {
  const seen: Array<string | undefined> = []
  const adapter: AxiosAdapter = async (config: InternalAxiosRequestConfig) => {
    const authorization = config.headers.get('Authorization')?.toString()
    seen.push(authorization)
    const response = {
      data: {},
      status: authorization === `Bearer ${accepted}` ? 200 : 401,
      statusText: '',
      headers: {},
      config,
    }
    if (response.status !== 200) {
      throw new AxiosError('Unauthorized', 'ERR_BAD_REQUEST', config, null, response)
    }
    return response
  }
  api.defaults.adapter = adapter
  return seen
}

beforeEach(() => {
  useAuthStore.setState({ accessToken: 'expired', isAuthenticated: true })
})

afterEach(() => {
  api.defaults.adapter = originalAdapter
  vi.restoreAllMocks()
})

describe('logging out with an expired access token', () => {
  it('refreshes and retries, so the server really ends the session', async () => {
    const seen = serve('fresh')
    const refresh = vi.spyOn(axios, 'post').mockResolvedValue({ data: { access_token: 'fresh' } })

    await authService.logout()

    expect(refresh).toHaveBeenCalledOnce()
    expect(seen).toEqual(['Bearer expired', 'Bearer fresh'])
  })

  it('stops after one retry when the new token is refused too', async () => {
    const seen = serve('never-accepted')
    const refresh = vi.spyOn(axios, 'post').mockResolvedValue({ data: { access_token: 'fresh' } })

    await authService.logout()

    expect(refresh).toHaveBeenCalledOnce()
    expect(seen).toEqual(['Bearer expired', 'Bearer fresh'])
  })

  it('treats a session that cannot refresh as already signed out', async () => {
    const seen = serve('never-accepted')
    vi.spyOn(axios, 'post').mockRejectedValue(new Error('no session'))

    await expect(authService.logout()).resolves.toBeUndefined()

    expect(seen).toEqual(['Bearer expired'])
    expect(useAuthStore.getState().isAuthenticated).toBe(false)
  })
})
