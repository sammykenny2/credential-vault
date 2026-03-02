import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { useAuthStore } from '@/stores/authStore'
import { authService } from '@/services/authService'
import { Shield, ChevronDown, ChevronUp } from 'lucide-react'

export default function LoginPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { setTokens, setUser, isAuthenticated } = useAuthStore()
  const [error, setError] = useState('')
  const [isRedirecting, setIsRedirecting] = useState(false)

  // Break-glass admin login
  const [showAdminLogin, setShowAdminLogin] = useState(false)
  const [adminEmail, setAdminEmail] = useState('')
  const [adminPassword, setAdminPassword] = useState('')

  // If already authenticated, redirect to dashboard
  useEffect(() => {
    if (isAuthenticated) {
      navigate('/dashboard')
    }
  }, [isAuthenticated, navigate])

  // Handle OAuth callback (code in URL params)
  const oauthCallbackMutation = useMutation({
    mutationFn: () => {
      const code = searchParams.get('code')
      if (!code) throw new Error('No OAuth code')
      return authService.googleCallback({
        code,
        redirect_uri: `${window.location.origin}/login`,
      })
    },
    onSuccess: async (data) => {
      setTokens(data.access_token, data.refresh_token)
      const user = await authService.getMe()
      setUser(user)
      navigate('/dashboard')
    },
    onError: () => {
      setError('Authentication failed. Please try again.')
      // Clear the OAuth code from URL
      window.history.replaceState({}, '', '/login')
    },
  })

  // Break-glass local login mutation
  const localLoginMutation = useMutation({
    mutationFn: () => authService.login(adminEmail, adminPassword),
    onSuccess: async (data) => {
      setTokens(data.access_token, data.refresh_token)
      const user = await authService.getMe()
      setUser(user)
      navigate('/dashboard')
    },
    onError: (err: unknown) => {
      const message = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(message || 'Login failed. Check your credentials.')
    },
  })

  // Auto-process OAuth callback if code is present
  useEffect(() => {
    const code = searchParams.get('code')
    if (code && !oauthCallbackMutation.isPending) {
      oauthCallbackMutation.mutate()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleGoogleLogin = async () => {
    setError('')
    setIsRedirecting(true)
    try {
      const redirectUri = `${window.location.origin}/login`
      const authUrl = await authService.getGoogleAuthUrl(redirectUri)
      window.location.href = authUrl
    } catch {
      setError('Failed to connect to Google. Please try again.')
      setIsRedirecting(false)
    }
  }

  const handleLocalLogin = (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    localLoginMutation.mutate()
  }

  const isProcessing = oauthCallbackMutation.isPending || isRedirecting || localLoginMutation.isPending

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <div className="card w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-primary-100 rounded-full mb-4">
            <Shield className="w-8 h-8 text-primary-600" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Credential Vault</h1>
          <p className="text-gray-500 mt-2">Sign in with your Google account</p>
        </div>

        {/* Error */}
        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm mb-6">
            {error}
          </div>
        )}

        {/* Google Sign In Button */}
        <button
          onClick={handleGoogleLogin}
          disabled={isProcessing}
          className="w-full flex items-center justify-center gap-3 px-4 py-3 border border-gray-300 rounded-lg shadow-sm bg-white hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24">
            <path
              fill="#4285F4"
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
            />
            <path
              fill="#34A853"
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            />
            <path
              fill="#FBBC05"
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
            />
            <path
              fill="#EA4335"
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
            />
          </svg>
          <span className="text-sm font-medium text-gray-700">
            {isProcessing ? 'Signing in...' : 'Sign in with Google'}
          </span>
        </button>

        {/* Admin Break-Glass Login */}
        <div className="mt-6 border-t border-gray-200 pt-4">
          <button
            onClick={() => setShowAdminLogin(!showAdminLogin)}
            className="w-full flex items-center justify-center gap-2 text-xs text-gray-400 hover:text-gray-600"
          >
            Admin Login
            {showAdminLogin ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>

          {showAdminLogin && (
            <form onSubmit={handleLocalLogin} className="mt-3 space-y-3">
              <input
                type="email"
                value={adminEmail}
                onChange={(e) => setAdminEmail(e.target.value)}
                placeholder="Admin email"
                className="input text-sm"
                required
              />
              <input
                type="password"
                value={adminPassword}
                onChange={(e) => setAdminPassword(e.target.value)}
                placeholder="Password"
                className="input text-sm"
                required
              />
              <button
                type="submit"
                disabled={isProcessing}
                className="w-full btn btn-secondary text-sm"
              >
                {localLoginMutation.isPending ? 'Signing in...' : 'Sign in as Admin'}
              </button>
            </form>
          )}
        </div>

        {/* Info */}
        <p className="text-xs text-gray-400 text-center mt-6">
          Your credentials are encrypted end-to-end. The server never sees your plaintext data.
        </p>
      </div>
    </div>
  )
}
