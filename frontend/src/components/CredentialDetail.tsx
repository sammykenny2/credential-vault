/**
 * Credential detail view with decryption.
 */

import { useState, useEffect } from 'react'
import { Eye, EyeOff, Copy, ExternalLink, X, Check } from 'lucide-react'
import { useCredentialCrypto } from '@/hooks/useCredentialCrypto'
import type { Credential } from '@/types'
import type { CredentialData } from '@/lib/crypto'

interface CredentialDetailProps {
  credential: Credential | null
  isOpen: boolean
  onClose: () => void
}

export default function CredentialDetail({
  credential,
  isOpen,
  onClose,
}: CredentialDetailProps) {
  const { decrypt, isProcessing, error } = useCredentialCrypto()
  const [decryptedData, setDecryptedData] = useState<CredentialData | null>(null)
  const [showPassword, setShowPassword] = useState(false)
  const [copiedField, setCopiedField] = useState<string | null>(null)

  useEffect(() => {
    if (credential && isOpen) {
      decryptCredential()
    } else {
      setDecryptedData(null)
      setShowPassword(false)
    }
  }, [credential, isOpen])

  const decryptCredential = async () => {
    if (!credential) return
    const data = await decrypt(credential.encrypted_data)
    setDecryptedData(data)
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
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6 m-4">
        {/* Header */}
        <div className="flex justify-between items-start mb-6">
          <div>
            <h2 className="text-xl font-bold text-gray-900">{credential.name}</h2>
            {credential.description && (
              <p className="text-gray-500 text-sm mt-1">{credential.description}</p>
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
            {credential.website_url && (
              <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <div>
                  <p className="text-xs text-gray-500 uppercase">Website</p>
                  <a
                    href={credential.website_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary-600 hover:underline flex items-center gap-1"
                  >
                    {credential.website_url}
                    <ExternalLink className="w-4 h-4" />
                  </a>
                </div>
              </div>
            )}

            {/* Username */}
            {decryptedData.username && (
              <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-gray-500 uppercase">Username</p>
                  <p className="font-mono truncate">{decryptedData.username}</p>
                </div>
                <button
                  onClick={() => copyToClipboard(decryptedData.username!, 'username')}
                  className="p-2 text-gray-400 hover:text-gray-600"
                  title="Copy username"
                >
                  {copiedField === 'username' ? (
                    <Check className="w-5 h-5 text-green-500" />
                  ) : (
                    <Copy className="w-5 h-5" />
                  )}
                </button>
              </div>
            )}

            {/* Password */}
            {decryptedData.password && (
              <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-gray-500 uppercase">Password</p>
                  <p className="font-mono truncate">
                    {showPassword ? decryptedData.password : '••••••••••••'}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setShowPassword(!showPassword)}
                    className="p-2 text-gray-400 hover:text-gray-600"
                    title={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                  <button
                    onClick={() => copyToClipboard(decryptedData.password!, 'password')}
                    className="p-2 text-gray-400 hover:text-gray-600"
                    title="Copy password"
                  >
                    {copiedField === 'password' ? (
                      <Check className="w-5 h-5 text-green-500" />
                    ) : (
                      <Copy className="w-5 h-5" />
                    )}
                  </button>
                </div>
              </div>
            )}

            {/* Notes */}
            {decryptedData.notes && (
              <div className="p-3 bg-gray-50 rounded-lg">
                <p className="text-xs text-gray-500 uppercase mb-1">Notes</p>
                <p className="text-gray-700 whitespace-pre-wrap">{decryptedData.notes}</p>
              </div>
            )}

            {/* Custom Fields */}
            {decryptedData.customFields && Object.keys(decryptedData.customFields).length > 0 && (
              <div className="space-y-2">
                <p className="text-xs text-gray-500 uppercase">Custom Fields</p>
                {Object.entries(decryptedData.customFields).map(([key, value]) => (
                  <div key={key} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-gray-500">{key}</p>
                      <p className="font-mono truncate">{value}</p>
                    </div>
                    <button
                      onClick={() => copyToClipboard(value, key)}
                      className="p-2 text-gray-400 hover:text-gray-600"
                    >
                      {copiedField === key ? (
                        <Check className="w-5 h-5 text-green-500" />
                      ) : (
                        <Copy className="w-5 h-5" />
                      )}
                    </button>
                  </div>
                ))}
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
