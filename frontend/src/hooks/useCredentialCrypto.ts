/**
 * React hook for credential encryption/decryption using hybrid E2EE.
 *
 * Uses RSA-OAEP public key for encryption and private key for decryption.
 * Every blob is bound to its credential id (AES-GCM additional data), so the
 * id must be known before encrypting and supplied again when decrypting.
 */

import { useCallback, useState } from 'react'
import { useVaultKey } from './useVaultKey'
import {
  encryptCredential,
  decryptCredential,
  exportPublicKey,
  generatePassword,
  type CredentialData,
} from '@/lib/crypto'

interface UseCredentialCryptoResult {
  // Encrypt credential data for the credential with this id
  encrypt: (data: CredentialData, credentialId: string) => Promise<string | null>
  // Decrypt credential data; the id is required for id-bound (v2) blobs
  decrypt: (encryptedData: string, credentialId?: string) => Promise<CredentialData | null>
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
 * Hook for encrypting and decrypting credentials with hybrid E2EE.
 */
export function useCredentialCrypto(): UseCredentialCryptoResult {
  const { getPrivateKey, getPublicKey, getExpectedPublicKeyBase64 } = useVaultKey()
  const [isProcessing, setIsProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const encrypt = useCallback(
    async (data: CredentialData, credentialId: string): Promise<string | null> => {
      const publicKey = getPublicKey()

      if (!publicKey) {
        setError('Vault is locked. Please enter your vault password.')
        return null
      }

      setIsProcessing(true)
      setError(null)

      try {
        // Verify the in-memory public key matches the server-registered key
        const expectedBase64 = getExpectedPublicKeyBase64()
        if (expectedBase64) {
          const currentBase64 = await exportPublicKey(publicKey)
          if (currentBase64 !== expectedBase64) {
            setError(
              'Public key mismatch: in-memory key does not match the registered key. Please re-unlock your vault.'
            )
            return null
          }
        }

        return await encryptCredential(data, publicKey, credentialId)
      } catch (err) {
        setError('Encryption failed. Please try again.')
        console.error('Encryption error:', err)
        return null
      } finally {
        setIsProcessing(false)
      }
    },
    [getPublicKey, getExpectedPublicKeyBase64]
  )

  const decrypt = useCallback(
    async (encryptedData: string, credentialId?: string): Promise<CredentialData | null> => {
      const privateKey = getPrivateKey()

      if (!privateKey) {
        setError('Vault is locked. Please enter your vault password.')
        return null
      }

      setIsProcessing(true)
      setError(null)

      try {
        return await decryptCredential(encryptedData, privateKey, credentialId)
      } catch (err) {
        setError('Decryption failed. Wrong vault password or corrupted data.')
        console.error('Decryption error:', err)
        return null
      } finally {
        setIsProcessing(false)
      }
    },
    [getPrivateKey]
  )

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
