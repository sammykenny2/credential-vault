import { useEffect } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import { authService } from '@/services/authService'
import Layout from '@/components/Layout'
import LoginPage from '@/pages/LoginPage'
import AdminSetupPage from '@/pages/AdminSetupPage'
import AdminLoginPage from '@/pages/AdminLoginPage'
import DashboardPage from '@/pages/DashboardPage'
import CredentialsPage from '@/pages/CredentialsPage'
import SettingsPage from '@/pages/SettingsPage'
import AdminUsersPage from '@/pages/AdminUsersPage'
import OfflineIndicator from '@/components/OfflineIndicator'

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, user } = useAuthStore()

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }

  // Wait for user data to be loaded (happens after page reload)
  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-gray-500">Loading...</div>
      </div>
    )
  }

  return <>{children}</>
}

function App() {
  const { isAuthenticated, user, setUser, logout } = useAuthStore()

  // Rehydrate user data on page refresh when token is persisted but user is not
  useEffect(() => {
    if (isAuthenticated && !user) {
      authService.getMe().then(setUser).catch(() => logout())
    }
  }, [isAuthenticated, user, setUser, logout])

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
