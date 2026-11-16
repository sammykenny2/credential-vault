/**
 * Form for creating/editing credentials with client-side encryption.
 * Pure key-value storage - all fields are dynamic.
 * Supports template-based field pre-population.
 */

import { useState } from 'react'
import { Eye, EyeOff, RefreshCw, X, Plus, Trash2 } from 'lucide-react'
import { useCredentialCrypto } from '@/hooks/useCredentialCrypto'
import { useOperationGuard } from '@/hooks/useOperationGuard'
import { OperationCancelledError, type OperationCheck } from '@/lib/operationGuard'
import type { CredentialData } from '@/lib/crypto'
import type { CredentialTemplate } from '@/types/template'
import { CATEGORY_LABELS } from '@/data/templates'
import { secretFieldProps, privateFieldProps } from '@/lib/inputProps'
import { isAxiosError } from 'axios'
import {
  editableFields, serializeFields, isSecretField, encodeFieldFile, readStoredFile,
  safeFileName, fileByteLength, MAX_RECORD_FILE_BYTES, MAX_RECORD_FILES,
  MAX_ENCRYPTED_RECORD_CHARS, type EditableField,
} from '@/lib/credentialFields'

type FieldEntry = EditableField

interface CredentialFormProps {
  isOpen: boolean
  onClose: () => void
  onSave: (
    data: { id: string; encrypted_data: string; expires_at?: string },
    templateId?: string,
    assertActive?: OperationCheck
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
  credentialId?: string
}

// Generate unique ID for field tracking
const generateId = () => crypto.randomUUID()

// Default fields for new credential
const getDefaultFields = (): FieldEntry[] => [
  { id: generateId(), key: 'Username', value: '', isSecret: false, type: 'text', required: false },
  { id: generateId(), key: 'Password', value: '', isSecret: true, type: 'text', required: false },
]

// Convert stored data to field entries
const dataToFields = (data?: CredentialData): FieldEntry[] => {
  return data ? editableFields(data) : getDefaultFields()
}

// Convert template to field entries (empty values, just field names)
const templateToFields = (template: CredentialTemplate): FieldEntry[] => {
  return template.fields.map((field) => ({
    id: generateId(),
    key: field.key,
    value: field.type === 'file' ? '' : field.defaultValue || '',
    isSecret: field.type === 'file' || field.isSecret,
    type: field.type ?? 'text',
    required: field.required ?? false,
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
  credentialId,
}: CredentialFormProps) {
  const { encrypt, generatePassword, isProcessing, error, clearError } = useCredentialCrypto()
  const { begin, cancel } = useOperationGuard(isOpen)
  const close = () => { cancel(); onClose() }

  // Initial values come from the props at mount time. The parent remounts this
  // component (via `key`) whenever it is opened with a different template or
  // credential, so no effect is needed to resynchronise state with props.
  const [initial] = useState(() => buildInitialFormState(initialData, template))

  // Details are encrypted together with field values at save time.
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
  const [isReading, setIsReading] = useState(false)
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
    setFields([...fields, { id: generateId(), key: '', value: '', isSecret: false, type: 'text', required: false }])
  }

  const updateField = (id: string, property: keyof FieldEntry, newValue: string | boolean) => {
    setFields(fields.map(f => {
      if (f.id !== id) return f
      const updated = { ...f, [property]: newValue }
      // Auto-detect secret fields based on key name
      if (property === 'key' && typeof newValue === 'string') {
        updated.isSecret = f.isSecret || isSecretField(newValue)
      }
      return updated
    }))
  }

  const removeField = (id: string) => {
    if (fields.find((field) => field.id === id)?.required) return
    setFields(fields.filter(f => f.id !== id))
  }

  const selectFile = async (fieldId: string, file?: File) => {
    if (!file) return
    setFormError('')
    setIsReading(true)
    let operation: ReturnType<typeof begin> | undefined
    try {
      operation = begin()
      const value = await encodeFieldFile(file)
      operation.assertActive()
      const next = fields.map((field) => field.id === fieldId ? { ...field, value } : field)
      const files = next.filter((field) => field.type === 'file' && field.value)
      if (files.length > MAX_RECORD_FILES || files.reduce((total, field) =>
        total + fileByteLength(readStoredFile(field.value)), 0) > MAX_RECORD_FILE_BYTES) {
        throw new Error('A credential supports up to 5 files and 256 KiB of file data.')
      }
      setFields(next)
    } catch (err) {
      if (!(err instanceof OperationCancelledError)) {
        setFormError(err instanceof Error ? err.message : 'Could not read file.')
      }
    } finally {
      operation?.finish()
      setIsReading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError('')
    clearError()
    if (isReading || isSaving) return

    if (!name.trim()) {
      setFormError('Name is required')
      return
    }

    // Validate at least one field has content
    const validFields = fields.filter(f => f.key.trim() && f.value.length > 0)
    if (validFields.length === 0 && !notes.trim()) {
      setFormError('At least one field or note is required')
      return
    }

    setIsSaving(true)
    let operation: ReturnType<typeof begin> | undefined
    try {
      operation = begin()
      // Build credential data — all metadata goes into the encrypted blob
      const credentialData: CredentialData = {
        name: name.trim(),
        ...serializeFields(fields),
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

      // Add notes if present
      if (notes.trim()) {
        credentialData.notes = notes
      }

      // The id is chosen here so the ciphertext can be bound to it.
      const targetId = credentialId ?? crypto.randomUUID()
      const encryptedData = await encrypt(credentialData, targetId)
      operation.assertActive()

      if (!encryptedData) {
        setFormError(error || 'Encryption failed')
        return
      }
      if (encryptedData.length > MAX_ENCRYPTED_RECORD_CHARS) {
        throw new Error('Credential is too large. Reduce the text or file data and try again.')
      }

      // All field values and options are inside the encrypted blob.
      await onSave({
        id: targetId,
        encrypted_data: encryptedData,
      }, template?.id, operation.assertActive)
      operation.assertActive()

      // Reset form and close
      onClose()
    } catch (err) {
      if (err instanceof OperationCancelledError) return
      setFormError(isAxiosError(err) && err.response?.status === 409
        ? 'This credential changed in another session. Your edits are still here. Reopen the latest version before applying them.'
        : err instanceof Error ? err.message : 'Save could not be confirmed. Your edits are still here.')
    } finally {
      operation?.finish()
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
          <button onClick={close} className="p-2 text-gray-400 hover:text-gray-600">
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

          <fieldset disabled={isSaving || isProcessing || isReading} className="space-y-4">
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
                disabled={fields.length >= 50}
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
                      aria-label="Field name"
                      required
                    />
                    <div className="flex gap-3 items-center my-2 text-sm">
                      <select
                        aria-label={`Type for ${field.key || 'new field'}`}
                        value={field.type}
                        className="input w-auto"
                        onChange={(event) => {
                          if (field.value && !confirm('Changing the field type clears its current value. Continue?')) return
                          setFields(fields.map((entry) => entry.id === field.id ? {
                            ...entry, type: event.target.value as 'text' | 'file', value: '',
                            isSecret: event.target.value === 'file' || entry.isSecret,
                          } : entry))
                        }}
                      >
                        <option value="text">Text</option>
                        <option value="file">File</option>
                      </select>
                      <label className="flex gap-1 items-center">
                        <input type="checkbox" checked={field.isSecret} disabled={field.type === 'file'}
                          onChange={(event) => updateField(field.id, 'isSecret', event.target.checked)} />
                        Secret
                      </label>
                      {field.required && <span className="text-gray-500">Required</span>}
                    </div>
                    {field.type === 'file' ? (
                      <div className="space-y-2 text-sm">
                        {field.value && <p className="break-all">{safeFileName(readStoredFile(field.value).name)} ({fileByteLength(readStoredFile(field.value))} bytes)</p>}
                        <input type="file" className="input" aria-label={`File for ${field.key || 'new field'}`}
                          onChange={(event) => { void selectFile(field.id, event.target.files?.[0]); event.target.value = '' }} />
                        <p className="text-xs text-gray-500">128 KiB per file; up to 5 files and 256 KiB per credential. Saved files are included in encrypted backups.</p>
                        {field.value && !field.required && <button type="button" className="text-red-600"
                          onClick={() => updateField(field.id, 'value', '')}>Remove file</button>}
                      </div>
                    ) : (
                    <div className="relative">
                      <input
                        {...secretFieldProps}
                        type={field.isSecret && !visibleFields.has(field.id) ? 'password' : 'text'}
                        value={field.value}
                        onChange={(e) => updateField(field.id, 'value', e.target.value)}
                        className="input pr-20 font-mono text-sm"
                        placeholder="Value"
                        aria-label={`Value for ${field.key || 'new field'}`}
                        required={field.required}
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
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => removeField(field.id)}
                    className="p-2 text-gray-400 hover:text-red-500 mt-1"
                    title="Remove field"
                    disabled={field.required}
                    aria-label={`Remove ${field.key || 'field'}`}
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
          </fieldset>

          {/* Actions */}
          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={close}
              className="btn btn-secondary flex-1"
              disabled={isSaving}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary flex-1"
              disabled={isSaving || isProcessing || isReading}
            >
              {isReading ? 'Reading file...' : isSaving || isProcessing ? 'Saving...' : 'Save'}
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
