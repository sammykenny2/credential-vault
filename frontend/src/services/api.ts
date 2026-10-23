import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios'
import { useAuthStore } from '@/stores/authStore'

const API_BASE_URL = import.meta.env.VITE_API_URL || '/api/v1'

export const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  // Send the HttpOnly refresh cookie on auth routes even when the API lives
  // on another origin during development.
  withCredentials: true,
})

// Request interceptor - add auth token
api.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    const token = useAuthStore.getState().accessToken
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }
    return config
  },
  (error) => Promise.reject(error)
)

let refreshPromise: Promise<string> | null = null

/**
 * Exchange the HttpOnly refresh cookie for a new access token.
 *
 * Concurrent callers share one in-flight request. Rejects when there is no
 * valid session, in which case the caller decides what to do.
 */
export async function refreshAccessToken(): Promise<string> {
  if (!refreshPromise) {
    refreshPromise = axios
      .post<{ access_token: string }>(`${API_BASE_URL}/auth/refresh`, null, {
        withCredentials: true,
      })
      .then((response) => {
        const token = response.data.access_token
        useAuthStore.getState().setAccessToken(token)
        return token
      })
      .finally(() => {
        refreshPromise = null
      })
  }
  return refreshPromise
}

// Requests that must never trigger a refresh-and-retry loop
const NO_RETRY_PATHS = ['/auth/refresh', '/auth/logout']

// Response interceptor - handle token refresh
api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as
      | (InternalAxiosRequestConfig & { _retry?: boolean })
      | undefined
    const url = originalRequest?.url ?? ''

    if (
      error.response?.status === 401 &&
      originalRequest &&
      !originalRequest._retry &&
      !NO_RETRY_PATHS.some((path) => url.endsWith(path))
    ) {
      originalRequest._retry = true
      try {
        const token = await refreshAccessToken()
        originalRequest.headers.Authorization = `Bearer ${token}`
        return api(originalRequest)
      } catch (refreshError) {
        useAuthStore.getState().logout()
        return Promise.reject(refreshError)
      }
    }

    return Promise.reject(error)
  }
)

export default api
