/**
 * Credential detail view with decryption.
 * All metadata (name, description, website_url, category) is read from decrypted data.
 */

import { useState, useEffect, useCallback } from 'react'
import { Eye, EyeOff, Copy, ExternalLink, X, Check } from 'lucide-react'
import { useCredentialCrypto } from '@/hooks/useCredentialCrypto'
import type { Credential } from '@/types'
import type { CredentialData } from '@/lib/crypto'

interface CredentialDetailProps {
  credential: Credential | null
  isOpen: boolean
  onClose: () => void
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
}: CredentialDetailProps) {
  const { decrypt, isProcessing, error } = useCredentialCrypto()
  const [decryptedData, setDecryptedData] = useState<CredentialData | null>(null)
  const [visibleFields, setVisibleFields] = useState<Set<string>>(new Set())
  const [copiedField, setCopiedField] = useState<string | null>(null)

  const decryptCredential = useCallback(async () => {
    if (!credential) return
    const data = await decrypt(credential.encrypted_data, credential.id)
    setDecryptedData(data)
  }, [credential, decrypt])

  useEffect(() => {
    if (credential && isOpen) {
      decryptCredential()
    } else {
      setDecryptedData(null)
      setVisibleFields(new Set())
    }
  }, [credential, isOpen, decryptCredential])

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

  if (!isOpen || !credential) return null

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6 m-4 max-h-[90vh] overflow-y-auto">
        {/* Header — metadata from decrypted data */}
        <div className="flex justify-between items-start mb-6">
          <div>
            <h2 className="text-xl font-bold text-gray-900">
              {decryptedData?.name || 'Decrypting...'}
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
          <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600">
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
