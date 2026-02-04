/**
 * Form for creating/editing credentials with client-side encryption.
 */

import { useState } from 'react'
import { Eye, EyeOff, RefreshCw, X } from 'lucide-react'
import { useCredentialCrypto } from '@/hooks/useCredentialCrypto'
import type { CredentialData } from '@/lib/crypto'

interface CredentialFormProps {
  isOpen: boolean
  onClose: () => void
  onSave: (data: { name: string; description?: string; website_url?: string; category?: string; encrypted_data: string }) => Promise<void>
  initialData?: {
    name: string
    description?: string
    website_url?: string
    category?: string
    credentialData?: CredentialData
  }
}

export default function CredentialForm({
  isOpen,
  onClose,
  onSave,
  initialData,
}: CredentialFormProps) {
  const { encrypt, generatePassword, isProcessing, error, clearError } = useCredentialCrypto()

  // Metadata (not encrypted)
  const [name, setName] = useState(initialData?.name || '')
  const [description, setDescription] = useState(initialData?.description || '')
  const [websiteUrl, setWebsiteUrl] = useState(initialData?.website_url || '')
  const [category, setCategory] = useState(initialData?.category || '')

  // Credential data (will be encrypted)
  const [username, setUsername] = useState(initialData?.credentialData?.username || '')
  const [password, setPassword] = useState(initialData?.credentialData?.password || '')
  const [notes, setNotes] = useState(initialData?.credentialData?.notes || '')

  // UI state
  const [showPassword, setShowPassword] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [formError, setFormError] = useState('')

  const handleGeneratePassword = () => {
    const newPassword = generatePassword(20, {
      uppercase: true,
      lowercase: true,
      numbers: true,
      symbols: true,
    })
    setPassword(newPassword)
    setShowPassword(true)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError('')
    clearError()

    if (!name.trim()) {
      setFormError('Name is required')
      return
    }

    setIsSaving(true)

    try {
      // Encrypt credential data
      const credentialData: CredentialData = {}
      if (username) credentialData.username = username
      if (password) credentialData.password = password
      if (notes) credentialData.notes = notes

      const encryptedData = await encrypt(credentialData)

      if (!encryptedData) {
        setFormError(error || 'Encryption failed')
        return
      }

      // Save to server
      await onSave({
        name: name.trim(),
        description: description.trim() || undefined,
        website_url: websiteUrl.trim() || undefined,
        category: category.trim() || undefined,
        encrypted_data: encryptedData,
      })

      // Reset form and close
      onClose()
    } catch (err) {
      setFormError('Failed to save credential')
      console.error('Save error:', err)
    } finally {
      setIsSaving(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6 m-4 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-bold text-gray-900">
            {initialData ? 'Edit Credential' : 'Add Credential'}
          </h2>
          <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {(formError || error) && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">
              {formError || error}
            </div>
          )}

          {/* Metadata Section */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wider">Details</h3>

            <div>
              <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1">
                Name <span className="text-red-500">*</span>
              </label>
              <input
                id="name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="input"
                placeholder="e.g., GitHub Account"
                required
              />
            </div>

            <div>
              <label htmlFor="website" className="block text-sm font-medium text-gray-700 mb-1">
                Website URL
              </label>
              <input
                id="website"
                type="url"
                value={websiteUrl}
                onChange={(e) => setWebsiteUrl(e.target.value)}
                className="input"
                placeholder="https://github.com"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="category" className="block text-sm font-medium text-gray-700 mb-1">
                  Category
                </label>
                <input
                  id="category"
                  type="text"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="input"
                  placeholder="e.g., Work"
                />
              </div>
              <div>
                <label htmlFor="description" className="block text-sm font-medium text-gray-700 mb-1">
                  Description
                </label>
                <input
                  id="description"
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="input"
                  placeholder="Brief description"
                />
              </div>
            </div>
          </div>

          {/* Credential Section */}
          <div className="space-y-4 pt-4 border-t border-gray-200">
            <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wider">
              Credentials (Encrypted)
            </h3>

            <div>
              <label htmlFor="username" className="block text-sm font-medium text-gray-700 mb-1">
                Username / Email
              </label>
              <input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="input"
                placeholder="user@example.com"
                autoComplete="off"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">
                Password
              </label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="input pr-10 font-mono"
                    placeholder="Enter password"
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
                <button
                  type="button"
                  onClick={handleGeneratePassword}
                  className="btn btn-secondary flex items-center gap-1"
                  title="Generate password"
                >
                  <RefreshCw className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div>
              <label htmlFor="notes" className="block text-sm font-medium text-gray-700 mb-1">
                Notes
              </label>
              <textarea
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="input min-h-[80px]"
                placeholder="Additional notes (security questions, etc.)"
              />
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="btn btn-secondary flex-1"
              disabled={isSaving}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary flex-1"
              disabled={isSaving || isProcessing}
            >
              {isSaving || isProcessing ? 'Encrypting...' : 'Save'}
            </button>
          </div>
        </form>

        {/* Encryption Notice */}
        <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded-lg">
          <p className="text-green-800 text-xs">
            <strong>Encrypted:</strong> Your credentials are encrypted in your browser
            before being sent to the server. Only you can decrypt them.
          </p>
        </div>
      </div>
    </div>
  )
}
