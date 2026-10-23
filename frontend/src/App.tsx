import { useEffect } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import { authService } from '@/services/authService'
import { refreshAccessToken } from '@/services/api'
import Layout from '@/components/Layout'
import LoginPage from '@/pages/LoginPage'
import AdminSetupPage from '@/pages/AdminSetupPage'
import AdminLoginPage from '@/pages/AdminLoginPage'
import DashboardPage from '@/pages/DashboardPage'
import CredentialsPage from '@/pages/CredentialsPage'
import SettingsPage from '@/pages/SettingsPage'
import AdminUsersPage from '@/pages/AdminUsersPage'
import OfflineIndicator from '@/components/OfflineIndicator'

function LoadingScreen() {
  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="text-gray-500">Loading...</div>
    </div>
  )
}

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, user, isBootstrapping } = useAuthStore()

  // Silent refresh on page load has not settled yet, or the user record is
  // still being fetched right after sign-in.
  if (isBootstrapping || (isAuthenticated && !user)) {
    return <LoadingScreen />
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }

  return <>{children}</>
}

function App() {
  const { setUser, finishBootstrap } = useAuthStore()

  // Restore the session on page load: the refresh token is an HttpOnly cookie,
  // so the only way to get an access token back is to ask the server.
  useEffect(() => {
    let cancelled = false

    const restoreSession = async () => {
      try {
        await refreshAccessToken()
        const me = await authService.getMe()
        if (!cancelled) setUser(me)
      } catch {
        // No valid session cookie: stay signed out.
        if (!cancelled) useAuthStore.getState().logout()
      } finally {
        if (!cancelled) finishBootstrap()
      }
    }

    restoreSession()
    return () => {
      cancelled = true
    }
  }, [setUser, finishBootstrap])

  return (
    <>
    <OfflineIndicator />
    <Routes>
      {/* Public routes */}
      <Route path="/login" element={<LoginPage />} />
      <Route path="/admin/setup" element={<AdminSetupPage />} />
      <Route path="/admin/login" element={<AdminLoginPage />} />

      {/* Protected routes */}
      <Route
        path="/"
        element={
          <PrivateRoute>
            <Layout />
          </PrivateRoute>
        }
      >
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="credentials" element={<CredentialsPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="admin/users" element={<AdminUsersPage />} />
      </Route>

      {/* Fallback */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </>
  )
}

export default App
