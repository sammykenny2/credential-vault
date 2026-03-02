/**
 * Modal for entering the vault password to unlock the E2EE vault.
 *
 * First time: Creates RSA key pair, encrypts private key with vault password, sends to server.
 * Subsequent: Decrypts RSA private key using vault password.
 */

import { useState } from 'react'
import { Lock, Eye, EyeOff } from 'lucide-react'
import { useVaultKey } from '@/hooks/useVaultKey'
import { useAuthStore } from '@/stores/authStore'
import { authService } from '@/services/authService'
import { setupVault, unlockVault } from '@/lib/crypto'

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
  const { setKeys } = useVaultKey()
  const { user, setUser } = useAuthStore()
  const [password, setPasswordInput] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  const needsSetup = isFirstTime || !user?.has_vault_keys

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setIsLoading(true)

    try {
      if (needsSetup) {
        // Setting up new vault
        if (password.length < 8) {
          setError('Vault password must be at least 8 characters')
          return
        }
        if (password !== confirmPassword) {
          setError('Passwords do not match')
          return
        }

        // Generate key pair and encrypt private key
        const vaultKeys = await setupVault(password)

        // Send public key and encrypted private key to server
        await authService.setupVault({
          public_key: vaultKeys.publicKeyBase64,
          encrypted_private_key: vaultKeys.encryptedPrivateKeyBase64,
          key_salt: vaultKeys.saltBase64,
        })

        // Store keys in memory
        setKeys(vaultKeys.privateKey, vaultKeys.publicKey)

        // Update user state to reflect vault setup
        const updatedUser = await authService.getMe()
        setUser(updatedUser)

        onUnlock()
      } else {
        // Unlock existing vault
        if (!user) {
          setError('User not loaded')
          return
        }

        // Fetch user's key material from the /auth/me response
        // The public_key and encrypted_private_key are stored on the user
        // We need to get them from the server
        const meResponse = await fetch('/api/v1/auth/me', {
          headers: {
            'Authorization': `Bearer ${useAuthStore.getState().accessToken}`,
          },
        })
        const meData = await meResponse.json()

        // Also fetch vault key material
        const keyResponse = await fetch('/api/v1/users/me', {
          headers: {
            'Authorization': `Bearer ${useAuthStore.getState().accessToken}`,
          },
        })
        const keyData = await keyResponse.json()

        // Try to decrypt the private key
        const keys = await unlockVault(
          password,
          keyData.key_salt || meData.key_salt,
          keyData.encrypted_private_key || meData.encrypted_private_key,
          keyData.public_key || meData.public_key,
        )

        // Store decrypted keys in memory
        setKeys(keys.privateKey, keys.publicKey)
        onUnlock()
      }
    } catch {
      setError(
        needsSetup
          ? 'Failed to set up vault. Please try again.'
          : 'Incorrect vault password or corrupted data.'
      )
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
            {needsSetup ? 'Set Up Vault Password' : 'Unlock Vault'}
          </h2>
          <p className="text-gray-500 mt-2 text-sm">
            {needsSetup
              ? 'Create a vault password to encrypt your credentials. This password is never sent to the server.'
              : 'Enter your vault password to decrypt your credentials.'}
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
            <label htmlFor="vault-password" className="block text-sm font-medium text-gray-700 mb-1">
              Vault Password
            </label>
            <div className="relative">
              <input
                id="vault-password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPasswordInput(e.target.value)}
                className="input pr-10"
                placeholder="Enter vault password"
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
                placeholder="Confirm vault password"
                required
              />
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading}
            className="btn btn-primary w-full"
          >
            {isLoading ? 'Processing...' : needsSetup ? 'Set Up Vault' : 'Unlock'}
          </button>
        </form>

        {/* Warning */}
        <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
          <p className="text-yellow-800 text-xs">
            <strong>Important:</strong> Your vault password cannot be recovered.
            If you forget it, you will lose access to all encrypted credentials.
          </p>
        </div>
      </div>
    </div>
  )
}
