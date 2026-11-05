/**
 * React hook for credential encryption/decryption using hybrid E2EE.
 *
 * Uses RSA-OAEP public key for encryption and private key for decryption.
 * Every blob is bound to its credential id (AES-GCM additional data), so the
 * id must be known before encrypting. Reading a record checks its signature
 * first: an unsigned or altered record is never decrypted.
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
import { RecordVerificationError, verifyRecord, type StoredRecord } from '@/lib/recordSigning'
import { captureOperation } from '@/lib/operationGuard'

interface UseCredentialCryptoResult {
  // Encrypt credential data for the credential with this id
  encrypt: (data: CredentialData, credentialId: string) => Promise<string | null>
  // Verify a record's signature, then decrypt it. Null means it was not opened.
  decrypt: (record: StoredRecord) => Promise<CredentialData | null>
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
  const { getPrivateKey, getPublicKey, getExpectedPublicKeyBase64, getSigner } = useVaultKey()
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
        const operation = captureOperation()
        // Verify the in-memory public key still matches the key checked at unlock.
        const expectedBase64 = getExpectedPublicKeyBase64()
        if (expectedBase64) {
          const currentBase64 = await exportPublicKey(publicKey)
          if (currentBase64 !== expectedBase64) {
            setError(
              'Public key mismatch: in-memory key does not match the verified vault key. Please re-unlock your vault.'
            )
            return null
          }
        }

        operation.assertActive()
        const encrypted = await encryptCredential(data, publicKey, credentialId)
        operation.assertActive()
        return encrypted
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
    async (record: StoredRecord): Promise<CredentialData | null> => {
      const privateKey = getPrivateKey()
      const signer = getSigner()

      if (!privateKey || !signer) {
        setError('Vault is locked. Please enter your vault password.')
        return null
      }

      setIsProcessing(true)
      setError(null)

      try {
        const operation = captureOperation()
        await verifyRecord(record, signer)
        operation.assertActive()
        const decrypted = await decryptCredential(record.encrypted_data, privateKey, record.id)
        operation.assertActive()
        return decrypted
      } catch (err) {
        if (err instanceof RecordVerificationError) {
          setError(err.message)
        } else {
          setError('Decryption failed. Wrong vault password or corrupted data.')
          console.error('Decryption error:', err)
        }
        return null
      } finally {
        setIsProcessing(false)
      }
    },
    [getPrivateKey, getSigner]
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
