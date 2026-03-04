import { useEffect } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import { authService } from '@/services/authService'
import Layout from '@/components/Layout'
import LoginPage from '@/pages/LoginPage'
import DashboardPage from '@/pages/DashboardPage'
import CredentialsPage from '@/pages/CredentialsPage'
import SettingsPage from '@/pages/SettingsPage'
import AdminUsersPage from '@/pages/AdminUsersPage'
import OfflineIndicator from '@/components/OfflineIndicator'

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuthStore()

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
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
