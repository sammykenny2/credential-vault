/**
 * Modal for entering the vault password to unlock the E2EE vault.
 *
 * First time: Creates the key pairs, encrypts them with the vault password, sends them to the server.
 * Subsequent: Decrypts them using the vault password.
 * A vault with no signing key yet must finish a one-time upgrade before it unlocks,
 * so the app never runs with records it could not sign or verify.
 */

import { useEffect, useState } from 'react'
import { Lock, Eye, EyeOff, X, ShieldCheck } from 'lucide-react'
import { useVaultKey } from '@/hooks/useVaultKey'
import { useAuthStore } from '@/stores/authStore'
import { authService } from '@/services/authService'
import api from '@/services/api'
import { credentialService } from '@/services/credentialService'
import {
  setupVault,
  unlockVault,
  KDF_VERSION,
  VaultKeyMismatchError,
  type UnlockedVault,
} from '@/lib/crypto'
import {
  hasSeenAnySignedVault,
  hasSeenSignedVault,
  performVaultUpgrade,
  rememberSignedVault,
  VaultRollbackError,
} from '@/lib/vaultUpgrade'
import type { CredentialListItem, VaultKeyMaterial } from '@/types'
import { secretFieldProps } from '@/lib/inputProps'
import { MIN_VAULT_PASSWORD_LENGTH } from '@/lib/passwordPolicy'

/**
 * The encrypted private key is downloadable by anyone holding a session token,
 * so the vault password must resist offline guessing. 12 characters minimum.
 */
export { MIN_VAULT_PASSWORD_LENGTH } from '@/lib/passwordPolicy'

/** The upgrade prompt holds the KEK; do not leave it waiting on an unattended screen. */
const UPGRADE_PROMPT_TIMEOUT_MS = 5 * 60 * 1000

interface MasterPasswordModalProps {
  isOpen: boolean
  onUnlock: () => void
  onClose?: () => void
  isFirstTime?: boolean
}

export default function MasterPasswordModal({
  isOpen,
  onUnlock,
  onClose,
  isFirstTime = false,
}: MasterPasswordModalProps) {
  const { setKeys } = useVaultKey()
  const { user, setUser } = useAuthStore()
  const [password, setPasswordInput] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [pendingUpgrade, setPendingUpgrade] = useState<{
    unlocked: UnlockedVault
    records: CredentialListItem[]
  } | null>(null)

  const needsSetup = isFirstTime || !user?.has_vault_keys

  useEffect(() => {
    if (!pendingUpgrade) return
    const timer = setTimeout(() => setPendingUpgrade(null), UPGRADE_PROMPT_TIMEOUT_MS)
    return () => clearTimeout(timer)
  }, [pendingUpgrade])

  const handleUpgrade = async () => {
    if (!pendingUpgrade) return
    setError('')
    setIsLoading(true)
    try {
      const { unlocked, records } = pendingUpgrade
      const signer = await performVaultUpgrade(unlocked, records)
      await rememberSignedVault(unlocked.publicKeyBase64)
      setKeys(unlocked.privateKey, unlocked.publicKey, unlocked.publicKeyBase64, signer)
      setPendingUpgrade(null)
      onUnlock()
    } catch (err) {
      console.error('Vault upgrade failed:', err)
      setPendingUpgrade(null)
      setError(
        err instanceof VaultRollbackError
          ? err.message
          : 'The upgrade did not complete and nothing was changed. Unlock again to retry.'
      )
    } finally {
      setIsLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setIsLoading(true)

    try {
      if (needsSetup) {
        // Setting up new vault
        if (password.length < MIN_VAULT_PASSWORD_LENGTH) {
          setError(`Vault password must be at least ${MIN_VAULT_PASSWORD_LENGTH} characters`)
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
          kdf_version: vaultKeys.kdfVersion,
          signing_public_key: vaultKeys.signingPublicKeyBase64,
        })

        // Store the locally generated, matching keys in memory.
        setKeys(
          vaultKeys.privateKey,
          vaultKeys.publicKey,
          vaultKeys.publicKeyBase64,
          vaultKeys.signer
        )

        // Update user state to reflect vault setup
        const updatedUser = await authService.getMe()
        setUser(updatedUser)
        await rememberSignedVault(vaultKeys.publicKeyBase64)

        onUnlock()
      } else {
        // Unlock existing vault
        if (!user) {
          setError('User not loaded')
          return
        }

        // Fetch vault key material (uses axios with auto token refresh)
        const { data: keyData } = await api.get<VaultKeyMaterial>('/auth/vault/keys')

        // Try to decrypt the private key with the KDF parameters it was wrapped with
        const keys = await unlockVault(
          password,
          keyData.key_salt,
          keyData.encrypted_private_key,
          keyData.public_key,
          keyData.kdf_version ?? KDF_VERSION,
        )

        if (!keys.signer) {
          // No signing key yet: finish the upgrade first, unless this browser has
          // seen this vault signed, which means the server replayed old keys.
          if (await hasSeenSignedVault(keys.publicKeyBase64)) throw new VaultRollbackError()
          setPendingUpgrade({ unlocked: keys, records: await credentialService.listAll() })
          return
        }

        // Only retain the public key derived from the authenticated private key.
        await rememberSignedVault(keys.publicKeyBase64)
        setKeys(keys.privateKey, keys.publicKey, keys.publicKeyBase64, keys.signer)
        onUnlock()
      }
    } catch (err) {
      console.error('Vault operation failed:', err)
      if (err instanceof VaultKeyMismatchError || err instanceof VaultRollbackError) {
        setError(err.message)
      } else if (needsSetup) {
        const detail = err instanceof Error ? err.message : String(err)
        setError(`Failed to set up vault: ${detail}`)
      } else {
        setError('Incorrect vault password or corrupted data.')
      }
    } finally {
      setIsLoading(false)
      setPasswordInput('')
      setConfirmPassword('')
    }
  }

  if (!isOpen) return null

  const handleClose = () => {
    if (onClose) {
      setError('')
      setPasswordInput('')
      setConfirmPassword('')
      setPendingUpgrade(null)
      onClose()
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={onClose ? handleClose : undefined}
    >
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 m-4 relative" onClick={(e) => e.stopPropagation()}>
        {/* Close button */}
        {onClose && (
          <button
            type="button"
            onClick={handleClose}
            className="absolute top-4 right-4 text-gray-400 hover:text-gray-600"
          >
            <X className="w-5 h-5" />
          </button>
        )}

        {pendingUpgrade ? (
          <div className="space-y-4">
            <div className="text-center">
              <div className="inline-flex items-center justify-center w-16 h-16 bg-primary-100 rounded-full mb-4">
                <ShieldCheck className="w-8 h-8 text-primary-600" />
              </div>
              <h2 className="text-xl font-bold text-gray-900">Upgrade Your Vault</h2>
            </div>
            <p className="text-sm text-gray-600">
              This one-time step adds a signing key to your vault, so a compromised server
              cannot plant or alter records without you noticing. Your data is not re-encrypted.
            </p>
            <p className="text-sm text-gray-600">
              <strong>{pendingUpgrade.records.length}</strong> existing record(s) will be
              signed and labelled <em>origin unverified</em>, because nothing can prove who wrote
              them. You can confirm each one when you open it. Only continue if you were expecting
              this upgrade.
            </p>
            {error && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">
                {error}
              </div>
            )}
            <button
              type="button"
              onClick={handleUpgrade}
              disabled={isLoading}
              className="btn btn-primary w-full"
            >
              {isLoading ? 'Upgrading...' : 'Upgrade and Unlock'}
            </button>
            <button
              type="button"
              onClick={() => setPendingUpgrade(null)}
              disabled={isLoading}
              className="btn btn-secondary w-full"
            >
              Cancel and Stay Locked
            </button>
          </div>
        ) : (
        <>
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
              ? `Create a vault password (at least ${MIN_VAULT_PASSWORD_LENGTH} characters) to encrypt your credentials. This password is never sent to the server.`
              : 'Enter your vault password to decrypt your credentials.'}
          </p>
        </div>

        {needsSetup && hasSeenAnySignedVault() && (
          <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
            This browser has unlocked a vault before. If this account already has one, stop here:
            the server may be hiding it, and a new vault cannot open your existing records.
          </div>
        )}

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
                {...secretFieldProps}
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
                {...secretFieldProps}
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
        </>
        )}
      </div>
    </div>
  )
}
