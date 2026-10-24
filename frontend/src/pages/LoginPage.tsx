import { useState, useEffect, useRef } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useAuthStore } from '@/stores/authStore'
import { authService } from '@/services/authService'
import { setupService } from '@/services/setupService'
import { Shield } from 'lucide-react'
import { beginOAuthFlow, clearOAuthFlow, consumeOAuthFlow, peekOAuthFlow } from '@/lib/oauthState'

export default function LoginPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { setAccessToken, setUser, isAuthenticated, isBootstrapping } = useAuthStore()
  const [error, setError] = useState('')
  const [isRedirecting, setIsRedirecting] = useState(false)
  // No setup check while an OAuth callback is being processed
  const [isOAuthCallback] = useState(() => Boolean(searchParams.get('code')))

  // Whether an admin exists decides what this page says. Right after a deploy
  // the backend may still be starting (nginx answers 502), so keep retrying
  // instead of showing the sign-in page without knowing.
  const setupStatus = useQuery({
    queryKey: ['setup-status'],
    queryFn: () => setupService.getStatus(),
    enabled: !isOAuthCallback,
    retry: true,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 5000),
    staleTime: 0,
  })
  const needsAdmin = setupStatus.data?.is_initialized === false

  // If already authenticated, redirect to dashboard (unless handling link callback)
  useEffect(() => {
    const code = searchParams.get('code')
    const pending = peekOAuthFlow()
    if (isAuthenticated && !(code && pending?.action === 'link')) {
      navigate('/dashboard')
    }
  }, [isAuthenticated, navigate, searchParams])

  // Handle OAuth callback (code in URL params)
  const oauthCallbackMutation = useMutation({
    mutationFn: async () => {
      const code = searchParams.get('code')
      if (!code) throw new Error('No OAuth code')

      // The state must match the one this tab generated before redirecting to
      // Google; otherwise this callback was not started by us (login CSRF).
      const flow = consumeOAuthFlow(searchParams.get('state'))
      if (!flow) throw new Error('OAuth state mismatch')

      if (flow.action === 'link') {
        // Link Google account flow — user is already authenticated
        const updatedUser = await authService.linkGoogleAccount({
          code,
          redirect_uri: `${window.location.origin}/login`,
        })
        setUser(updatedUser)
        navigate('/settings')
        return null
      }

      // Normal login flow
      return authService.googleCallback({
        code,
        redirect_uri: `${window.location.origin}/login`,
      })
    },
    onSuccess: async (data) => {
      if (!data) return // Link flow already handled
      setAccessToken(data.access_token)
      const user = await authService.getMe()
      setUser(user)
      navigate('/dashboard')
    },
    onError: (err: unknown) => {
      clearOAuthFlow()
      const mismatch = err instanceof Error && err.message === 'OAuth state mismatch'
      setError(
        mismatch
          ? 'Sign-in could not be verified (state mismatch). Please start again from this page.'
          : 'Authentication failed. Please try again.'
      )
      // Clear the OAuth code from URL
      window.history.replaceState({}, '', '/login')
    },
  })

  // Auto-process OAuth callback if code is present (ref prevents double-fire in strict mode)
  const oauthProcessed = useRef(false)
  useEffect(() => {
    const code = searchParams.get('code')
    const oauthError = searchParams.get('error')
    if (oauthError && !oauthProcessed.current) {
      // Google reported an error (for example access_denied); drop the pending flow.
      oauthProcessed.current = true
      clearOAuthFlow()
      window.history.replaceState({}, '', '/login')
      setError('Google sign-in was cancelled or denied.')
      return
    }
    if (code && !oauthProcessed.current) {
      oauthProcessed.current = true
      window.history.replaceState({}, '', '/login')
      oauthCallbackMutation.mutate()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleGoogleLogin = async () => {
    setError('')
    setIsRedirecting(true)
    const state = beginOAuthFlow('login')
    try {
      const redirectUri = `${window.location.origin}/login`
      const authUrl = await authService.getGoogleAuthUrl(redirectUri, state)
      window.location.href = authUrl
    } catch {
      clearOAuthFlow()
      setError('Failed to connect to Google. Please try again.')
      setIsRedirecting(false)
    }
  }

  const isProcessing = oauthCallbackMutation.isPending || isRedirecting

  if ((!isOAuthCallback && setupStatus.isPending) || isBootstrapping) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <div className="text-gray-500">
          {setupStatus.failureCount > 0 ? 'Waiting for the server to start...' : 'Loading...'}
        </div>
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
          <h1 className="text-2xl font-bold text-gray-900">Credential Vault</h1>
          <p className="text-gray-500 mt-2">Sign in with your Google account</p>
        </div>

        {/* Error */}
        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm mb-6">
            {error}
          </div>
        )}

        {/* First run: the first Google sign-in becomes the admin (app/api/v1/oauth.py) */}
        {needsAdmin && (
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-800 text-sm mb-6">
            <p className="font-medium">No administrator yet</p>
            <p className="mt-1">
              The first Google account to sign in becomes the administrator. To use an email
              and a break-glass password instead,{' '}
              <Link to="/admin/setup" className="underline">
                create the administrator here
              </Link>
              .
            </p>
          </div>
        )}

        {/* Google Sign In Button */}
        <button
          onClick={handleGoogleLogin}
          disabled={isProcessing}
          className="w-full flex items-center justify-center gap-3 px-4 py-3 border border-gray-300 rounded-lg shadow-xs bg-white hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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

        {/* Info */}
        <p className="text-xs text-gray-400 text-center mt-6">
          Your credentials are encrypted end-to-end. The server never sees your plaintext data.
        </p>
      </div>
    </div>
  )
}
