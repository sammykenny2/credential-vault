/**
 * Form for creating/editing credentials with client-side encryption.
 * Pure key-value storage - all fields are dynamic.
 * Supports template-based field pre-population.
 */

import { useState } from 'react'
import { Eye, EyeOff, RefreshCw, X, Plus, Trash2 } from 'lucide-react'
import { useCredentialCrypto } from '@/hooks/useCredentialCrypto'
import type { CredentialData } from '@/lib/crypto'
import type { CredentialTemplate } from '@/types/template'
import { CATEGORY_LABELS } from '@/data/templates'
import { secretFieldProps, privateFieldProps } from '@/lib/inputProps'

interface FieldEntry {
  id: string
  key: string
  value: string
  isSecret: boolean // Whether to mask the value
}

interface CredentialFormProps {
  isOpen: boolean
  onClose: () => void
  onSave: (
    data: { id: string; encrypted_data: string; expires_at?: string },
    templateId?: string
  ) => Promise<void>
  initialData?: {
    name: string
    description?: string
    website_url?: string
    category?: string
    credentialData?: CredentialData
  }
  /** Template to pre-populate fields from */
  template?: CredentialTemplate | null
}

// Generate unique ID for field tracking
const generateId = () => Math.random().toString(36).substring(2, 9)

// Default fields for new credential
const getDefaultFields = (): FieldEntry[] => [
  { id: generateId(), key: 'Username', value: '', isSecret: false },
  { id: generateId(), key: 'Password', value: '', isSecret: true },
]

// Convert stored data to field entries
const dataToFields = (data?: CredentialData): FieldEntry[] => {
  if (!data?.fields || Object.keys(data.fields).length === 0) {
    return getDefaultFields()
  }
  return Object.entries(data.fields).map(([key, value]) => ({
    id: generateId(),
    key,
    value,
    isSecret: key.toLowerCase().includes('password') ||
              key.toLowerCase().includes('secret') ||
              key.toLowerCase().includes('key') ||
              key.toLowerCase().includes('token'),
  }))
}

// Convert template to field entries (empty values, just field names)
const templateToFields = (template: CredentialTemplate): FieldEntry[] => {
  return template.fields.map((field) => ({
    id: generateId(),
    key: field.key,
    value: field.defaultValue || '',
    isSecret: field.isSecret,
  }))
}

interface InitialFormState {
  name: string
  description: string
  websiteUrl: string
  category: string
  fields: FieldEntry[]
  notes: string
}

// Starting values for a fresh form: existing credential, template, or blank.
function buildInitialFormState(
  initialData: CredentialFormProps['initialData'],
  template?: CredentialTemplate | null
): InitialFormState {
  if (initialData) {
    return {
      name: initialData.name,
      description: initialData.description || '',
      websiteUrl: initialData.website_url || '',
      category: initialData.category || '',
      fields: dataToFields(initialData.credentialData),
      notes: initialData.credentialData?.notes || '',
    }
  }
  if (template) {
    return {
      name: '',
      description: template.description || '',
      websiteUrl: '',
      category: template.category ? CATEGORY_LABELS[template.category] : '',
      fields: templateToFields(template),
      notes: '',
    }
  }
  return {
    name: '',
    description: '',
    websiteUrl: '',
    category: '',
    fields: getDefaultFields(),
    notes: '',
  }
}

export default function CredentialForm({
  isOpen,
  onClose,
  onSave,
  initialData,
  template,
}: CredentialFormProps) {
  const { encrypt, generatePassword, isProcessing, error, clearError } = useCredentialCrypto()

  // Initial values come from the props at mount time. The parent remounts this
  // component (via `key`) whenever it is opened with a different template or
  // credential, so no effect is needed to resynchronise state with props.
  const [initial] = useState(() => buildInitialFormState(initialData, template))

  // Metadata (not encrypted)
  const [name, setName] = useState(initial.name)
  const [description, setDescription] = useState(initial.description)
  const [websiteUrl, setWebsiteUrl] = useState(initial.websiteUrl)
  const [category, setCategory] = useState(initial.category)

  // Credential fields (will be encrypted)
  const [fields, setFields] = useState<FieldEntry[]>(initial.fields)
  const [notes, setNotes] = useState(initial.notes)

  // UI state
  const [visibleFields, setVisibleFields] = useState<Set<string>>(new Set())
  const [isSaving, setIsSaving] = useState(false)
  const [formError, setFormError] = useState('')

  const toggleFieldVisibility = (fieldId: string) => {
    setVisibleFields(prev => {
      const next = new Set(prev)
      if (next.has(fieldId)) {
        next.delete(fieldId)
      } else {
        next.add(fieldId)
      }
      return next
    })
  }

  const handleGeneratePassword = (fieldId: string) => {
    const newPassword = generatePassword(20, {
      uppercase: true,
      lowercase: true,
      numbers: true,
      symbols: true,
    })
    updateField(fieldId, 'value', newPassword)
    setVisibleFields(prev => new Set(prev).add(fieldId))
  }

  const addField = () => {
    setFields([...fields, { id: generateId(), key: '', value: '', isSecret: false }])
  }

  const updateField = (id: string, property: keyof FieldEntry, newValue: string | boolean) => {
    setFields(fields.map(f => {
      if (f.id !== id) return f
      const updated = { ...f, [property]: newValue }
      // Auto-detect secret fields based on key name
      if (property === 'key' && typeof newValue === 'string') {
        const keyLower = newValue.toLowerCase()
        updated.isSecret = keyLower.includes('password') ||
                          keyLower.includes('secret') ||
                          keyLower.includes('key') ||
                          keyLower.includes('token')
      }
      return updated
    }))
  }

  const removeField = (id: string) => {
    if (fields.length <= 1) return // Keep at least one field
    setFields(fields.filter(f => f.id !== id))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError('')
    clearError()

    if (!name.trim()) {
      setFormError('Name is required')
      return
    }

    // Validate at least one field has content
    const validFields = fields.filter(f => f.key.trim() && f.value.trim())
    if (validFields.length === 0 && !notes.trim()) {
      setFormError('At least one field or note is required')
      return
    }

    setIsSaving(true)

    try {
      // Build credential data — all metadata goes into the encrypted blob
      const credentialData: CredentialData = {
        name: name.trim(),
        fields: {},
      }

      // Add metadata into encrypted blob
      if (description.trim()) {
        credentialData.description = description.trim()
      }
      if (websiteUrl.trim()) {
        credentialData.website_url = websiteUrl.trim()
      }
      if (category.trim()) {
        credentialData.category = category.trim()
      }

      // Add all non-empty fields
      for (const field of fields) {
        if (field.key.trim()) {
          credentialData.fields[field.key.trim()] = field.value
        }
      }

      // Add notes if present
      if (notes.trim()) {
        credentialData.notes = notes.trim()
      }

      // The id is chosen here so the ciphertext can be bound to it.
      const credentialId = crypto.randomUUID()
      const encryptedData = await encrypt(credentialData, credentialId)

      if (!encryptedData) {
        setFormError(error || 'Encryption failed')
        return
      }

      // Save to server — only encrypted_data (all metadata is inside)
      await onSave({
        id: credentialId,
        encrypted_data: encryptedData,
      }, template?.id)

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
          <div>
            <h2 className="text-xl font-bold text-gray-900">
              {initialData ? 'Edit Credential' : 'Add Credential'}
            </h2>
            {template && !initialData && (
              <p className="text-sm text-gray-500 mt-1">
                Using template: {template.icon} {template.name}
              </p>
            )}
          </div>
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
                {...privateFieldProps}
                id="name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="input"
                placeholder="e.g., Google AI Studio"
                required
              />
            </div>

            <div>
              <label htmlFor="website" className="block text-sm font-medium text-gray-700 mb-1">
                Website URL
              </label>
              <input
                {...privateFieldProps}
                id="website"
                type="url"
                value={websiteUrl}
                onChange={(e) => setWebsiteUrl(e.target.value)}
                className="input"
                placeholder="https://aistudio.google.com"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="category" className="block text-sm font-medium text-gray-700 mb-1">
                  Category
                </label>
                <input
                  {...privateFieldProps}
                  id="category"
                  type="text"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="input"
                  placeholder="e.g., API Keys"
                />
              </div>
              <div>
                <label htmlFor="description" className="block text-sm font-medium text-gray-700 mb-1">
                  Description
                </label>
                <input
                  {...privateFieldProps}
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

          {/* Credential Fields Section */}
          <div className="space-y-4 pt-4 border-t border-gray-200">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wider">
                Credentials (Encrypted)
              </h3>
              <button
                type="button"
                onClick={addField}
                className="text-sm text-primary-600 hover:text-primary-700 flex items-center gap-1"
              >
                <Plus className="w-4 h-4" />
                Add Field
              </button>
            </div>

            <div className="space-y-3">
              {fields.map((field) => (
                <div key={field.id} className="flex gap-2 items-start">
                  <div className="flex-1">
                    <input
                      {...privateFieldProps}
                      type="text"
                      value={field.key}
                      onChange={(e) => updateField(field.id, 'key', e.target.value)}
                      className="input mb-1"
                      placeholder="Field name (e.g., API Key)"
                    />
                    <div className="relative">
                      <input
                        {...secretFieldProps}
                        type={field.isSecret && !visibleFields.has(field.id) ? 'password' : 'text'}
                        value={field.value}
                        onChange={(e) => updateField(field.id, 'value', e.target.value)}
                        className="input pr-20 font-mono text-sm"
                        placeholder="Value"
                      />
                      <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                        {field.isSecret && (
                          <>
                            <button
                              type="button"
                              onClick={() => toggleFieldVisibility(field.id)}
                              className="p-1 text-gray-400 hover:text-gray-600"
                              title={visibleFields.has(field.id) ? 'Hide' : 'Show'}
                            >
                              {visibleFields.has(field.id) ? (
                                <EyeOff className="w-4 h-4" />
                              ) : (
                                <Eye className="w-4 h-4" />
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleGeneratePassword(field.id)}
                              className="p-1 text-gray-400 hover:text-gray-600"
                              title="Generate"
                            >
                              <RefreshCw className="w-4 h-4" />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeField(field.id)}
                    className="p-2 text-gray-400 hover:text-red-500 mt-1"
                    title="Remove field"
                    disabled={fields.length <= 1}
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                </div>
              ))}
            </div>

            {/* Notes */}
            <div>
              <label htmlFor="notes" className="block text-sm font-medium text-gray-700 mb-1">
                Notes
              </label>
              <textarea
                {...secretFieldProps}
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="input min-h-[80px]"
                placeholder="Additional notes (security questions, recovery codes, etc.)"
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
            <strong>Encrypted:</strong> All credential fields are encrypted in your browser
            before being sent to the server. Only you can decrypt them.
          </p>
        </div>
      </div>
    </div>
  )
}
