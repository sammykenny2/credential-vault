/**
 * Add a password to an admin account that has none.
 *
 * An admin who became admin through Google sign-in has no password. With one,
 * the account is the same as an admin created on /admin/setup and later
 * linked to Google: it signs in with Google, or with email and password at
 * /admin/login. The server requires proof of unlock, so a stolen session
 * token cannot add a password and keep access.
 *
 * The sign-in password is sent to the server on every sign-in; the vault
 * password must never be. Before saving, the form checks in the browser that
 * the new password does not unwrap the vault key.
 */

import { useState } from 'react'
import { LogIn, Eye, EyeOff } from 'lucide-react'
import api from '@/services/api'
import { authService } from '@/services/authService'
import { isVaultPassword, KDF_VERSION } from '@/lib/crypto'
import { vaultProofHeaders, VaultLockedError } from '@/lib/vaultProof'
import { useVaultKey } from '@/hooks/useVaultKey'
import { useAuthStore } from '@/stores/authStore'
import type { VaultKeyMaterial } from '@/types'

// Same rule as the /admin/setup page and the backend (app/schemas/user.py)
const MIN_PASSWORD_LENGTH = 8
const MAX_PASSWORD_BYTES = 72

export default function AdminPasswordSetup() {
  const { isUnlocked } = useVaultKey()
  const setUser = useAuthStore((state) => state.setUser)
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPasswords, setShowPasswords] = useState(false)
  const [error, setError] = useState('')
  const [isBusy, setIsBusy] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`)
      return
    }
    if (new TextEncoder().encode(password).length > MAX_PASSWORD_BYTES) {
      setError(`Password must be at most ${MAX_PASSWORD_BYTES} bytes.`)
      return
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    setIsBusy(true)
    try {
      const { data: keys } = await api.get<VaultKeyMaterial>('/auth/vault/keys')
      const reused = await isVaultPassword(
        password,
        keys.key_salt,
        keys.encrypted_private_key,
        keys.kdf_version ?? KDF_VERSION
      )
      if (reused) {
        setError(
          'This is your vault password. Choose a different one: the sign-in password is sent to the server, the vault password never is.'
        )
        return
      }

      const headers = await vaultProofHeaders()
      // The updated user has has_password set, which hides this form.
      setUser(await authService.setPassword(password, headers))
    } catch (err) {
      setError(
        err instanceof VaultLockedError
          ? 'Unlock your vault on the Credentials page first.'
          : 'The password could not be saved. Nothing was changed.'
      )
    } finally {
      setIsBusy(false)
    }
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <LogIn className="w-5 h-5 text-gray-600" />
        <h2 className="text-lg font-semibold">Sign in with Password</h2>
      </div>

      <p className="text-sm text-gray-500 mb-4">
        This admin account signs in with Google only. Add a password to also sign in with your
        email and password at <span className="font-mono">/admin/login</span>, for example when
        Google sign-in is unavailable. Use a different password from your vault password. The
        vault must be unlocked.
      </p>

      {!isUnlocked && (
        <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-yellow-800 text-sm mb-4">
          The vault is locked. Open the Credentials page and unlock it, then come back here.
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-3">
        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">
            {error}
          </div>
        )}

        <div>
          <label htmlFor="admin-password" className="block text-sm font-medium text-gray-700 mb-1">
            Password
          </label>
          <div className="relative">
            <input
              id="admin-password"
              type={showPasswords ? 'text' : 'password'}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input pr-10"
              placeholder={`Minimum ${MIN_PASSWORD_LENGTH} characters`}
              required
              disabled={!isUnlocked || isBusy}
            />
            <button
              type="button"
              onClick={() => setShowPasswords(!showPasswords)}
              disabled={!isUnlocked || isBusy}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 disabled:cursor-not-allowed disabled:hover:text-gray-400"
              aria-label={showPasswords ? 'Hide passwords' : 'Show passwords'}
            >
              {showPasswords ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
            </button>
          </div>
        </div>

        <div>
          <label htmlFor="admin-password-confirm" className="block text-sm font-medium text-gray-700 mb-1">
            Confirm Password
          </label>
          <input
            id="admin-password-confirm"
            type={showPasswords ? 'text' : 'password'}
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="input"
            required
            disabled={!isUnlocked || isBusy}
          />
        </div>

        <button type="submit" className="btn btn-primary" disabled={!isUnlocked || isBusy}>
          {isBusy ? 'Saving...' : 'Add Password'}
        </button>
      </form>
    </div>
  )
}
