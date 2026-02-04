import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { useAuthStore } from '@/stores/authStore'
import { authService } from '@/services/authService'
import { Shield } from 'lucide-react'

export default function MFAPage() {
  const navigate = useNavigate()
  const { setRequiresMFA } = useAuthStore()
  const [code, setCode] = useState('')
  const [error, setError] = useState('')

  const verifyMutation = useMutation({
    mutationFn: () => authService.verifyMFA(code),
    onSuccess: () => {
      setRequiresMFA(false)
      navigate('/dashboard')
    },
    onError: () => {
      setError('Invalid verification code')
      setCode('')
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    verifyMutation.mutate()
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <div className="card w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-primary-100 rounded-full mb-4">
            <Shield className="w-8 h-8 text-primary-600" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Two-Factor Authentication</h1>
          <p className="text-gray-500 mt-2">
            Enter the 6-digit code from your authenticator app
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-6">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">
              {error}
            </div>
          )}

          <div>
            <label htmlFor="code" className="block text-sm font-medium text-gray-700 mb-1">
              Verification Code
            </label>
            <input
              id="code"
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              className="input text-center text-2xl tracking-widest"
              placeholder="000000"
              maxLength={6}
              autoComplete="one-time-code"
              required
            />
          </div>

          <button
            type="submit"
            disabled={verifyMutation.isPending || code.length !== 6}
            className="btn btn-primary w-full"
          >
            {verifyMutation.isPending ? 'Verifying...' : 'Verify'}
          </button>
        </form>
      </div>
    </div>
  )
}
