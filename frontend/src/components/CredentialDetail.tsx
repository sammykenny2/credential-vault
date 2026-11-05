/**
 * Credential detail view with decryption.
 * All metadata (name, description, website_url, category) is read from decrypted data.
 */

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Eye, EyeOff, Copy, ExternalLink, X, Check, ShieldAlert } from 'lucide-react'
import { useCredentialCrypto } from '@/hooks/useCredentialCrypto'
import { useOperationGuard } from '@/hooks/useOperationGuard'
import { OperationCancelledError } from '@/lib/operationGuard'
import { credentialService } from '@/services/credentialService'
import type { Credential } from '@/types'
import type { CredentialData } from '@/lib/crypto'

interface CredentialDetailProps {
  credential: Credential | null
  isOpen: boolean
  onClose: () => void
  /** The user confirmed a legacy-unverified record; it now has a new signed state. */
  onOriginConfirmed?: (updated: Credential) => void
}

// Detect if a field should be treated as secret based on its key
const isSecretField = (key: string): boolean => {
  const keyLower = key.toLowerCase()
  return keyLower.includes('password') ||
         keyLower.includes('secret') ||
         keyLower.includes('key') ||
         keyLower.includes('token')
}

export default function CredentialDetail({
  credential,
  isOpen,
  onClose,
  onOriginConfirmed,
}: CredentialDetailProps) {
  const { decrypt, isProcessing, error } = useCredentialCrypto()
  const { begin, cancel } = useOperationGuard(isOpen)
  const [visibleFields, setVisibleFields] = useState<Set<string>>(new Set())
  const [copiedField, setCopiedField] = useState<string | null>(null)
  const [isConfirming, setIsConfirming] = useState(false)
  const [confirmError, setConfirmError] = useState('')

  // Decrypt through a query so the plaintext is dropped (gcTime 0) as soon as
  // the dialog unmounts; the parent remounts it via `key` per credential.
  const current = credential
  const { data: decryptedData = null } = useQuery<CredentialData | null>({
    queryKey: ['credential-plaintext', current?.id, current?.revision, current?.signature],
    queryFn: () => (current ? decrypt(current) : Promise.resolve(null)),
    enabled: current !== null && isOpen,
    gcTime: 0,
    staleTime: Infinity,
  })

  const toggleFieldVisibility = (fieldKey: string) => {
    setVisibleFields(prev => {
      const next = new Set(prev)
      if (next.has(fieldKey)) {
        next.delete(fieldKey)
      } else {
        next.add(fieldKey)
      }
      return next
    })
  }

  const copyToClipboard = async (text: string, field: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedField(field)
      setTimeout(() => setCopiedField(null), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  const confirmOrigin = async () => {
    if (!credential) return
    setConfirmError('')
    setIsConfirming(true)
    let operation: ReturnType<typeof begin> | undefined
    try {
      operation = begin()
      // Pass the record the user just read: what gets signed is what they reviewed.
      const updated = await credentialService.confirmOrigin(credential, operation.assertActive)
      operation.assertActive()
      onOriginConfirmed?.(updated)
    } catch (err) {
      if (err instanceof OperationCancelledError) return
      console.error('Confirming the record failed:', err)
      setConfirmError('Could not confirm this record. Close this view and check it before trying again.')
    } finally {
      operation?.finish()
      setIsConfirming(false)
    }
  }

  if (!isOpen || !credential) return null

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6 m-4 max-h-[90vh] overflow-y-auto">
        {/* Header — metadata from decrypted data */}
        <div className="flex justify-between items-start mb-6">
          <div>
            <h2 className="text-xl font-bold text-gray-900">
              {decryptedData?.name || (error ? 'Record not opened' : 'Decrypting...')}
            </h2>
            {decryptedData?.description && (
              <p className="text-gray-500 text-sm mt-1">{decryptedData.description}</p>
            )}
            {decryptedData?.category && (
              <span className="inline-block mt-2 px-2 py-0.5 text-xs bg-gray-100 rounded-full">
                {decryptedData.category}
              </span>
            )}
          </div>
          <button onClick={() => { cancel(); onClose() }} className="p-2 text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        {isProcessing ? (
          <div className="text-center py-8">
            <div className="animate-spin w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full mx-auto" />
            <p className="text-gray-500 mt-2">Decrypting...</p>
          </div>
        ) : error ? (
          <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-600">
            {error}
          </div>
        ) : decryptedData ? (
          <div className="space-y-4">
            {/* decryptedData is only set after the signature verified, so origin is signed */}
            {credential.origin === 'legacy-unverified' && (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
                <div className="flex gap-2">
                  <ShieldAlert className="w-5 h-5 shrink-0" />
                  <p>
                    <strong>Origin unverified.</strong> This record existed before the vault could
                    sign, or came from a backup without signatures. Nothing proves who wrote it.
                    Check that it looks right, especially any website address.
                  </p>
                </div>
                {confirmError && <p className="mt-2 text-red-600">{confirmError}</p>}
                <button
                  type="button"
                  onClick={confirmOrigin}
                  disabled={isConfirming}
                  className="btn btn-secondary text-sm mt-2"
                >
                  {isConfirming ? 'Confirming...' : 'I checked this record, it is mine'}
                </button>
              </div>
            )}

            {/* Website */}
            {decryptedData.website_url && (
              <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <div>
                  <p className="text-xs text-gray-500 uppercase">Website</p>
                  <a
                    href={decryptedData.website_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary-600 hover:underline flex items-center gap-1"
                  >
                    {decryptedData.website_url}
                    <ExternalLink className="w-4 h-4" />
                  </a>
                </div>
              </div>
            )}

            {/* Credential Fields */}
            {decryptedData.fields && Object.keys(decryptedData.fields).length > 0 && (
              <div className="space-y-2">
                {Object.entries(decryptedData.fields).map(([key, value]) => {
                  const isSecret = isSecretField(key)
                  const isVisible = visibleFields.has(key)

                  return (
                    <div key={key} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-gray-500 uppercase">{key}</p>
                        <p className="font-mono truncate">
                          {isSecret && !isVisible ? '••••••••••••' : value}
                        </p>
                      </div>
                      <div className="flex items-center gap-1">
                        {isSecret && (
                          <button
                            onClick={() => toggleFieldVisibility(key)}
                            className="p-2 text-gray-400 hover:text-gray-600"
                            title={isVisible ? 'Hide' : 'Show'}
                          >
                            {isVisible ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                          </button>
                        )}
                        <button
                          onClick={() => copyToClipboard(value, key)}
                          className="p-2 text-gray-400 hover:text-gray-600"
                          title="Copy"
                        >
                          {copiedField === key ? (
                            <Check className="w-5 h-5 text-green-500" />
                          ) : (
                            <Copy className="w-5 h-5" />
                          )}
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {/* Notes */}
            {decryptedData.notes && (
              <div className="p-3 bg-gray-50 rounded-lg">
                <p className="text-xs text-gray-500 uppercase mb-1">Notes</p>
                <p className="text-gray-700 whitespace-pre-wrap">{decryptedData.notes}</p>
              </div>
            )}
          </div>
        ) : null}

        {/* Footer */}
        <div className="mt-6 pt-4 border-t border-gray-200">
          <div className="flex justify-between text-xs text-gray-400">
            <span>Created: {new Date(credential.created_at).toLocaleDateString()}</span>
            <span>Updated: {new Date(credential.updated_at).toLocaleDateString()}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
