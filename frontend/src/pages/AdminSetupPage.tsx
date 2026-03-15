import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { useAuthStore } from '@/stores/authStore'
import { authService } from '@/services/authService'
import { setupService } from '@/services/setupService'
import { Shield } from 'lucide-react'

export default function AdminSetupPage() {
  const navigate = useNavigate()
  const { setTokens, setUser, isAuthenticated } = useAuthStore()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [error, setError] = useState('')
  const [checkingStatus, setCheckingStatus] = useState(true)

  // Redirect if already authenticated
  useEffect(() => {
    if (isAuthenticated) {
      navigate('/dashboard')
    }
  }, [isAuthenticated, navigate])

  // Check if setup is already complete
  useEffect(() => {
    setupService
      .getStatus()
      .then((status) => {
        if (status.is_initialized) {
          navigate('/login', { replace: true })
        } else {
          setCheckingStatus(false)
        }
      })
      .catch(() => {
        setError('Failed to check setup status. Please try again.')
        setCheckingStatus(false)
      })
  }, [navigate])

  const createAdminMutation = useMutation({
    mutationFn: () =>
      setupService.createAdmin(email, password, displayName || undefined),
    onSuccess: async (data) => {
      setTokens(data.access_token, data.refresh_token)
      const user = await authService.getMe()
      setUser(user)
      navigate('/dashboard')
    },
    onError: (err: unknown) => {
      const status = (err as { response?: { status?: number } })?.response
        ?.status
      if (status === 409) {
        navigate('/login', { replace: true })
        return
      }
      const message = (
        err as { response?: { data?: { detail?: string } } }
      )?.response?.data?.detail
      setError(message || 'Failed to create admin account. Please try again.')
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }

    createAdminMutation.mutate()
  }

  if (checkingStatus) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <div className="text-gray-500">Loading...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <div className="card w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-primary-100 rounded-full mb-4">
            <Shield className="w-8 h-8 text-primary-600" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">
            Credential Vault Setup
          </h1>
          <p className="text-gray-500 mt-2">
            Create your admin account to get started
          </p>
        </div>

        {/* Error */}
        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm mb-6">
            {error}
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="email"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@example.com"
              className="input"
              required
            />
          </div>

          <div>
            <label
              htmlFor="displayName"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              Display Name{' '}
              <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <input
              id="displayName"
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Admin"
              className="input"
            />
          </div>

          <div>
            <label
              htmlFor="password"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Minimum 8 characters"
              className="input"
              required
              minLength={8}
            />
          </div>

          <div>
            <label
              htmlFor="confirmPassword"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              Confirm Password
            </label>
            <input
              id="confirmPassword"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Repeat your password"
              className="input"
              required
              minLength={8}
            />
          </div>

          <button
            type="submit"
            disabled={createAdminMutation.isPending}
            className="w-full btn btn-primary"
          >
            {createAdminMutation.isPending
              ? 'Creating account...'
              : 'Create Admin Account'}
          </button>
        </form>

        {/* Info */}
        <p className="text-xs text-gray-400 text-center mt-6">
          This account will have full admin access to the vault.
        </p>
      </div>
    </div>
  )
}
