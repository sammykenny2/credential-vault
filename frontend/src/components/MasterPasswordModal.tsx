/**
 * Modal for entering the master password to unlock the vault.
 */

import { useState } from 'react'
import { Lock, Eye, EyeOff } from 'lucide-react'
import { useMasterPassword } from '@/hooks/useMasterPassword'

interface MasterPasswordModalProps {
  isOpen: boolean
  onUnlock: () => void
  isFirstTime?: boolean
}

export default function MasterPasswordModal({
  isOpen,
  onUnlock,
  isFirstTime = false,
}: MasterPasswordModalProps) {
  const { setPassword, verifyPassword, hasPassword } = useMasterPassword()
  const [password, setPasswordInput] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  const needsSetup = isFirstTime || !hasPassword

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setIsLoading(true)

    try {
      if (needsSetup) {
        // Setting up new master password
        if (password.length < 8) {
          setError('Master password must be at least 8 characters')
          return
        }
        if (password !== confirmPassword) {
          setError('Passwords do not match')
          return
        }
        await setPassword(password)
        onUnlock()
      } else {
        // Verifying existing master password
        const isValid = await verifyPassword(password)
        if (isValid) {
          await setPassword(password)
          onUnlock()
        } else {
          setError('Incorrect master password')
        }
      }
    } catch {
      setError('An error occurred. Please try again.')
    } finally {
      setIsLoading(false)
      setPasswordInput('')
      setConfirmPassword('')
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 m-4">
        {/* Header */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-primary-100 rounded-full mb-4">
            <Lock className="w-8 h-8 text-primary-600" />
          </div>
          <h2 className="text-xl font-bold text-gray-900">
            {needsSetup ? 'Set Master Password' : 'Unlock Vault'}
          </h2>
          <p className="text-gray-500 mt-2 text-sm">
            {needsSetup
              ? 'Create a master password to encrypt your credentials. This password is never sent to the server.'
              : 'Enter your master password to access your credentials.'}
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">
              {error}
            </div>
          )}

          <div>
            <label htmlFor="master-password" className="block text-sm font-medium text-gray-700 mb-1">
              Master Password
            </label>
            <div className="relative">
              <input
                id="master-password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPasswordInput(e.target.value)}
                className="input pr-10"
                placeholder="Enter master password"
                autoFocus
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
          </div>

          {needsSetup && (
            <div>
              <label htmlFor="confirm-password" className="block text-sm font-medium text-gray-700 mb-1">
                Confirm Password
              </label>
              <input
                id="confirm-password"
                type={showPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="input"
                placeholder="Confirm master password"
                required
              />
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading}
            className="btn btn-primary w-full"
          >
            {isLoading ? 'Processing...' : needsSetup ? 'Set Password' : 'Unlock'}
          </button>
        </form>

        {/* Warning */}
        <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
          <p className="text-yellow-800 text-xs">
            <strong>Important:</strong> Your master password cannot be recovered.
            If you forget it, you will lose access to all encrypted credentials.
          </p>
        </div>
      </div>
    </div>
  )
}
