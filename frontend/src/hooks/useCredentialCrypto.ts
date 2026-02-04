/**
 * React hook for credential encryption/decryption.
 *
 * Provides easy-to-use functions for encrypting credentials before
 * sending to server and decrypting after fetching.
 */

import { useCallback, useState } from 'react'
import { useMasterPassword } from './useMasterPassword'
import {
  encryptCredential,
  decryptCredential,
  generatePassword,
  type CredentialData,
} from '@/lib/crypto'

interface UseCredentialCryptoResult {
  // Encrypt credential data
  encrypt: (data: CredentialData) => Promise<string | null>
  // Decrypt credential data
  decrypt: (encryptedData: string) => Promise<CredentialData | null>
  // Generate a random password
  generatePassword: typeof generatePassword
  // Loading state
  isProcessing: boolean
  // Error message
  error: string | null
  // Clear error
  clearError: () => void
}

/**
 * Hook for encrypting and decrypting credentials.
 *
 * @example
 * ```tsx
 * const { encrypt, decrypt, isProcessing, error } = useCredentialCrypto()
 *
 * // Encrypt before saving
 * const encrypted = await encrypt({ username: 'user', password: 'pass' })
 *
 * // Decrypt after fetching
 * const decrypted = await decrypt(credential.encrypted_data)
 * ```
 */
export function useCredentialCrypto(): UseCredentialCryptoResult {
  const { getMasterPassword, isUnlocked } = useMasterPassword()
  const [isProcessing, setIsProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const encrypt = useCallback(async (data: CredentialData): Promise<string | null> => {
    const masterPassword = getMasterPassword()

    if (!masterPassword) {
      setError('Vault is locked. Please enter your master password.')
      return null
    }

    setIsProcessing(true)
    setError(null)

    try {
      const encrypted = await encryptCredential(data, masterPassword)
      return encrypted
    } catch (err) {
      setError('Encryption failed. Please try again.')
      console.error('Encryption error:', err)
      return null
    } finally {
      setIsProcessing(false)
    }
  }, [getMasterPassword])

  const decrypt = useCallback(async (encryptedData: string): Promise<CredentialData | null> => {
    const masterPassword = getMasterPassword()

    if (!masterPassword) {
      setError('Vault is locked. Please enter your master password.')
      return null
    }

    setIsProcessing(true)
    setError(null)

    try {
      const decrypted = await decryptCredential(encryptedData, masterPassword)
      return decrypted
    } catch (err) {
      setError('Decryption failed. Wrong master password or corrupted data.')
      console.error('Decryption error:', err)
      return null
    } finally {
      setIsProcessing(false)
    }
  }, [getMasterPassword])

  const clearError = useCallback(() => {
    setError(null)
  }, [])

  return {
    encrypt,
    decrypt,
    generatePassword,
    isProcessing,
    error,
    clearError,
  }
}
