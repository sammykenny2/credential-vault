import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios'
import { useAuthStore } from '@/stores/authStore'
import { OperationCancelledError, type OperationCheck } from '@/lib/operationGuard'
import { useVaultKeyStore } from '@/hooks/useVaultKey'

declare module 'axios' {
  interface AxiosRequestConfig {
    authGeneration?: number
    vaultGeneration?: number
    rateRetries?: number
    assertOperation?: OperationCheck
  }
}

const API_BASE_URL = import.meta.env.VITE_API_URL || '/api/v1'

export const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  // Send the HttpOnly refresh cookie on auth routes even when the API lives
  // on another origin during development.
  withCredentials: true,
  timeout: 30_000,
})

// Request interceptor - add auth token
api.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    config.assertOperation?.()
    config.signal ??= config.assertOperation?.signal
    const { accessToken: token, generation } = useAuthStore.getState()
    config.authGeneration ??= generation
    config.vaultGeneration ??= useVaultKeyStore.getState().generation
    if (config.authGeneration !== generation ||
        config.vaultGeneration !== useVaultKeyStore.getState().generation) throw new OperationCancelledError()
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }
    return config
  },
  (error) => { throw error },
  { synchronous: true }
)

let refreshRequest: { generation: number; promise: Promise<string> } | null = null

/**
 * Exchange the HttpOnly refresh cookie for a new access token.
 *
 * Concurrent callers share one in-flight request. Rejects when there is no
 * valid session, in which case the caller decides what to do.
 */
export async function refreshAccessToken(): Promise<string> {
  const { generation, user } = useAuthStore.getState()
  if (!refreshRequest || refreshRequest.generation !== generation) {
    const exchange = () => {
      if (useAuthStore.getState().generation !== generation) throw new OperationCancelledError()
      return axios.post<{ access_token: string; user_id: string }>(`${API_BASE_URL}/auth/refresh`, null, {
        withCredentials: true, timeout: 30_000,
      })
    }
    const promise = (navigator.locks
      ? navigator.locks.request('credential-vault:refresh', exchange)
      : exchange())
      .then((response) => {
        if (useAuthStore.getState().generation !== generation) throw new OperationCancelledError()
        if (user && response.data.user_id !== user.id) {
          useAuthStore.getState().logout()
          throw new OperationCancelledError()
        }
        const token = response.data.access_token
        useAuthStore.getState().setAccessToken(token)
        return token
      })
      .finally(() => {
        if (refreshRequest?.promise === promise) refreshRequest = null
      })
    refreshRequest = { generation, promise }
  }
  return refreshRequest.promise
}

// Requests that must never trigger a refresh-and-retry loop
const NO_RETRY_PATHS = ['/auth/refresh', '/auth/logout', '/auth/login', '/auth/verify-password', '/oauth/google/callback', '/setup/admin']

// Response interceptor - handle token refresh
api.interceptors.response.use(
  (response) => {
    response.config.assertOperation?.()
    if (response.config.authGeneration !== useAuthStore.getState().generation ||
        response.config.vaultGeneration !== useVaultKeyStore.getState().generation) {
      throw new OperationCancelledError()
    }
    return response
  },
  async (error: AxiosError) => {
    const originalRequest = error.config as
      | (InternalAxiosRequestConfig & { _retry?: boolean })
      | undefined
    const url = originalRequest?.url ?? ''
    originalRequest?.assertOperation?.()
    const generation = useAuthStore.getState().generation
    if (originalRequest && (originalRequest.authGeneration !== generation ||
        originalRequest.vaultGeneration !== useVaultKeyStore.getState().generation)) {
      return Promise.reject(new OperationCancelledError())
    }
    if (error.response?.status === 429 && originalRequest && (originalRequest.rateRetries ?? 0) < 2) {
      const seconds = Number(error.response.headers['retry-after'])
      if (Number.isFinite(seconds) && seconds > 0 && seconds <= 60) {
        originalRequest.rateRetries = (originalRequest.rateRetries ?? 0) + 1
        await new Promise((resolve) => setTimeout(resolve, seconds * 1000))
        // The synchronous request interceptor checks both captured generations again.
        return api(originalRequest)
      }
    }

    if (
      error.response?.status === 401 &&
      originalRequest &&
      !originalRequest._retry &&
      !NO_RETRY_PATHS.some((path) => url.endsWith(path))
    ) {
      originalRequest._retry = true
      try {
        const token = await refreshAccessToken()
        if (useAuthStore.getState().generation !== generation) throw new OperationCancelledError()
        originalRequest.headers.Authorization = `Bearer ${token}`
        return api(originalRequest)
      } catch (refreshError) {
        if (useAuthStore.getState().generation === generation) useAuthStore.getState().logout()
        return Promise.reject(refreshError)
      }
    }

    return Promise.reject(error)
  }
)

export default api
