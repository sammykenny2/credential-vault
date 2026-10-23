/**
 * Change the vault password.
 *
 * Only the wrapping of the private key changes: it is unwrapped with the
 * current password and wrapped again with the new one (new salt, current KDF
 * version). The key pair stays the same, so stored credentials remain
 * readable. The server requires proof of unlock before accepting the new
 * wrapped key, so a stolen session token cannot lock the owner out.
 */

import { useState } from 'react'
import { KeyRound, Eye, EyeOff } from 'lucide-react'
import api from '@/services/api'
import { authService } from '@/services/authService'
import { rewrapPrivateKey, KDF_VERSION } from '@/lib/crypto'
import { vaultProofHeaders, VaultLockedError } from '@/lib/vaultProof'
import { useVaultKey } from '@/hooks/useVaultKey'
import { MIN_VAULT_PASSWORD_LENGTH } from '@/components/MasterPasswordModal'
import type { VaultKeyMaterial } from '@/types'

export default function VaultPasswordChange() {
  const { isUnlocked } = useVaultKey()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPasswords, setShowPasswords] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [isBusy, setIsBusy] = useState(false)

  const reset = () => {
    setCurrentPassword('')
    setNewPassword('')
    setConfirmPassword('')
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSuccess(false)

    if (newPassword.length < MIN_VAULT_PASSWORD_LENGTH) {
      setError(`New vault password must be at least ${MIN_VAULT_PASSWORD_LENGTH} characters.`)
      return
    }
    if (newPassword !== confirmPassword) {
      setError('New passwords do not match.')
      return
    }
    if (newPassword === currentPassword) {
      setError('New vault password must differ from the current one.')
      return
    }

    setIsBusy(true)
    try {
      // Proof first: it needs the unlocked private key and fails fast when locked.
      const headers = await vaultProofHeaders()

      const { data: keys } = await api.get<VaultKeyMaterial>('/auth/vault/keys')
      const rewrapped = await rewrapPrivateKey(
        currentPassword,
        newPassword,
        keys.key_salt,
        keys.encrypted_private_key,
        keys.kdf_version ?? KDF_VERSION
      )

      await authService.rekeyVault(
        {
          encrypted_private_key: rewrapped.encryptedPrivateKeyBase64,
          key_salt: rewrapped.saltBase64,
          kdf_version: rewrapped.kdfVersion,
        },
        headers
      )

      setSuccess(true)
      reset()
    } catch (err) {
      if (err instanceof VaultLockedError) {
        setError('Unlock your vault on the Credentials page first.')
      } else {
        // rewrapPrivateKey throws on a wrong current password (GCM tag mismatch)
        setError('Current vault password is incorrect, or the update failed. Nothing was changed.')
      }
    } finally {
      setIsBusy(false)
    }
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <KeyRound className="w-5 h-5 text-gray-600" />
        <h2 className="text-lg font-semibold">Change Vault Password</h2>
      </div>

      <p className="text-sm text-gray-500 mb-4">
        Re-wraps your encryption key with a new password. Your credentials are not
        re-encrypted and remain readable. The vault must be unlocked.
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
        {success && (
          <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm">
            Vault password changed. Use the new password the next time you unlock.
          </div>
        )}

        <div>
          <label htmlFor="current-vault-password" className="block text-sm font-medium text-gray-700 mb-1">
            Current Vault Password
          </label>
          <div className="relative">
            <input
              id="current-vault-password"
              type={showPasswords ? 'text' : 'password'}
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="input pr-10"
              required
              disabled={!isUnlocked || isBusy}
            />
            <button
              type="button"
              onClick={() => setShowPasswords(!showPasswords)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              aria-label={showPasswords ? 'Hide passwords' : 'Show passwords'}
            >
              {showPasswords ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
            </button>
          </div>
        </div>

        <div>
          <label htmlFor="new-vault-password" className="block text-sm font-medium text-gray-700 mb-1">
            New Vault Password
          </label>
          <input
            id="new-vault-password"
            type={showPasswords ? 'text' : 'password'}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className="input"
            placeholder={`At least ${MIN_VAULT_PASSWORD_LENGTH} characters`}
            required
            minLength={MIN_VAULT_PASSWORD_LENGTH}
            disabled={!isUnlocked || isBusy}
          />
        </div>

        <div>
          <label htmlFor="confirm-vault-password" className="block text-sm font-medium text-gray-700 mb-1">
            Confirm New Vault Password
          </label>
          <input
            id="confirm-vault-password"
            type={showPasswords ? 'text' : 'password'}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="input"
            required
            minLength={MIN_VAULT_PASSWORD_LENGTH}
            disabled={!isUnlocked || isBusy}
          />
        </div>

        <button type="submit" className="btn btn-primary" disabled={!isUnlocked || isBusy}>
          {isBusy ? 'Updating...' : 'Change Vault Password'}
        </button>
      </form>

      <p className="text-xs text-gray-400 mt-3">
        Forgot the current password? It cannot be recovered. Export a backup from any
        unlocked session before you lose access.
      </p>
    </div>
  )
}
