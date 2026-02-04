/**
 * Template Manager Component
 *
 * Manages custom templates in Settings page.
 * Features:
 * - List custom templates with edit/delete
 * - View built-in templates (read-only)
 * - Create new custom templates
 * - Template editor dialog
 */

import { useState, useMemo } from 'react'
import {
  Plus,
  Pencil,
  Trash2,
  X,
  ChevronDown,
  ChevronRight,
  Eye,
  Lock,
} from 'lucide-react'
import type { CredentialTemplate, TemplateField, TemplateCategory } from '@/types/template'
import { BUILTIN_TEMPLATES_BY_CATEGORY, CATEGORY_LABELS, CATEGORY_ORDER } from '@/data/templates'
import {
  getCustomTemplates,
  createCustomTemplate,
  updateCustomTemplate,
  deleteCustomTemplate,
  getTemplateUsageStats,
} from '@/lib/templateStorage'

// =============================================================================
// Template Editor Dialog
// =============================================================================

interface TemplateEditorProps {
  isOpen: boolean
  onClose: () => void
  onSave: (template: Omit<CredentialTemplate, 'id' | 'isBuiltIn' | 'createdAt' | 'updatedAt'>) => void
  initialData?: CredentialTemplate
  mode: 'create' | 'edit' | 'view'
}

function TemplateEditor({ isOpen, onClose, onSave, initialData, mode }: TemplateEditorProps) {
  const [name, setName] = useState(initialData?.name || '')
  const [description, setDescription] = useState(initialData?.description || '')
  const [icon, setIcon] = useState(initialData?.icon || '📄')
  const [category, setCategory] = useState<TemplateCategory | ''>(initialData?.category || '')
  const [fields, setFields] = useState<TemplateField[]>(
    initialData?.fields || [{ key: '', isSecret: false }]
  )
  const [error, setError] = useState('')

  const isReadOnly = mode === 'view'
  const title = mode === 'create' ? 'Create Template' : mode === 'edit' ? 'Edit Template' : 'View Template'

  const handleAddField = () => {
    setFields([...fields, { key: '', isSecret: false }])
  }

  const handleRemoveField = (index: number) => {
    if (fields.length <= 1) return
    setFields(fields.filter((_, i) => i !== index))
  }

  const handleFieldChange = (index: number, updates: Partial<TemplateField>) => {
    setFields(fields.map((f, i) => (i === index ? { ...f, ...updates } : f)))
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!name.trim()) {
      setError('Template name is required')
      return
    }

    const validFields = fields.filter((f) => f.key.trim())
    if (validFields.length === 0) {
      setError('At least one field is required')
      return
    }

    onSave({
      name: name.trim(),
      description: description.trim() || undefined,
      icon: icon || '📄',
      category: category || undefined,
      fields: validFields.map((f) => ({
        key: f.key.trim(),
        isSecret: f.isSecret,
        placeholder: f.placeholder,
        required: f.required,
      })),
    })
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6 m-4 max-h-[85vh] overflow-y-auto">
        {/* Header */}
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-bold text-gray-900">{title}</h2>
          <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">
              {error}
            </div>
          )}

          {/* Basic Info */}
          <div className="grid grid-cols-[auto_1fr] gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Icon</label>
              <input
                type="text"
                value={icon}
                onChange={(e) => setIcon(e.target.value.slice(0, 2))}
                className="input w-16 text-center text-2xl"
                disabled={isReadOnly}
                maxLength={2}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="input"
                placeholder="e.g., My Custom API"
                disabled={isReadOnly}
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="input"
              placeholder="Brief description of this template"
              disabled={isReadOnly}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as TemplateCategory | '')}
              className="input"
              disabled={isReadOnly}
            >
              <option value="">None</option>
              {CATEGORY_ORDER.map((cat) => (
                <option key={cat} value={cat}>
                  {CATEGORY_LABELS[cat]}
                </option>
              ))}
            </select>
          </div>

          {/* Fields */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-gray-700">
                Fields <span className="text-red-500">*</span>
              </label>
              {!isReadOnly && (
                <button
                  type="button"
                  onClick={handleAddField}
                  className="text-sm text-primary-600 hover:text-primary-700 flex items-center gap-1"
                >
                  <Plus className="w-4 h-4" />
                  Add Field
                </button>
              )}
            </div>

            {fields.map((field, index) => (
              <div key={index} className="flex items-center gap-2">
                <input
                  type="text"
                  value={field.key}
                  onChange={(e) => handleFieldChange(index, { key: e.target.value })}
                  className="input flex-1"
                  placeholder="Field name (e.g., API Key)"
                  disabled={isReadOnly}
                />
                <label className="flex items-center gap-2 text-sm text-gray-600 whitespace-nowrap">
                  <input
                    type="checkbox"
                    checked={field.isSecret}
                    onChange={(e) => handleFieldChange(index, { isSecret: e.target.checked })}
                    className="rounded border-gray-300"
                    disabled={isReadOnly}
                  />
                  Secret
                </label>
                {!isReadOnly && (
                  <button
                    type="button"
                    onClick={() => handleRemoveField(index)}
                    className="p-1 text-gray-400 hover:text-red-500"
                    disabled={fields.length <= 1}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-4">
            <button type="button" onClick={onClose} className="btn btn-secondary flex-1">
              {isReadOnly ? 'Close' : 'Cancel'}
            </button>
            {!isReadOnly && (
              <button type="submit" className="btn btn-primary flex-1">
                {mode === 'create' ? 'Create Template' : 'Save Changes'}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  )
}

// =============================================================================
// Template List Item
// =============================================================================

interface TemplateListItemProps {
  template: CredentialTemplate
  useCount: number
  onEdit?: () => void
  onDelete?: () => void
  onView?: () => void
}

function TemplateListItem({ template, useCount, onEdit, onDelete, onView }: TemplateListItemProps) {
  return (
    <div className="flex items-center gap-3 p-3 rounded-lg border border-gray-200 hover:border-gray-300 transition-colors">
      <span className="text-2xl">{template.icon || '📄'}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium truncate">{template.name}</span>
          {template.isBuiltIn && (
            <Lock className="w-3 h-3 text-gray-400" title="Built-in template" />
          )}
        </div>
        <div className="text-sm text-gray-500">
          {template.fields.length} field{template.fields.length !== 1 ? 's' : ''}
          {useCount > 0 && <span className="ml-2">· Used {useCount}x</span>}
        </div>
      </div>
      <div className="flex items-center gap-1">
        {template.isBuiltIn ? (
          <button
            onClick={onView}
            className="p-2 text-gray-400 hover:text-gray-600"
            title="View"
          >
            <Eye className="w-4 h-4" />
          </button>
        ) : (
          <>
            <button
              onClick={onEdit}
              className="p-2 text-gray-400 hover:text-primary-600"
              title="Edit"
            >
              <Pencil className="w-4 h-4" />
            </button>
            <button
              onClick={onDelete}
              className="p-2 text-gray-400 hover:text-red-500"
              title="Delete"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </>
        )}
      </div>
    </div>
  )
}

// =============================================================================
// Main Component
// =============================================================================

export default function TemplateManager() {
  const [customTemplates, setCustomTemplates] = useState(() => getCustomTemplates())
  const [editorOpen, setEditorOpen] = useState(false)
  const [editorMode, setEditorMode] = useState<'create' | 'edit' | 'view'>('create')
  const [editingTemplate, setEditingTemplate] = useState<CredentialTemplate | undefined>()
  const [showBuiltIn, setShowBuiltIn] = useState(false)

  // Refresh custom templates from storage
  const refreshTemplates = () => {
    setCustomTemplates(getCustomTemplates())
  }

  // Get usage stats for all templates
  const usageStats = useMemo(() => {
    const stats = new Map<string, number>()
    for (const template of [...customTemplates, ...Object.values(BUILTIN_TEMPLATES_BY_CATEGORY).flat()]) {
      const stat = getTemplateUsageStats(template.id)
      stats.set(template.id, stat.useCount)
    }
    return stats
  }, [customTemplates])

  const handleCreate = () => {
    setEditingTemplate(undefined)
    setEditorMode('create')
    setEditorOpen(true)
  }

  const handleEdit = (template: CredentialTemplate) => {
    setEditingTemplate(template)
    setEditorMode('edit')
    setEditorOpen(true)
  }

  const handleView = (template: CredentialTemplate) => {
    setEditingTemplate(template)
    setEditorMode('view')
    setEditorOpen(true)
  }

  const handleDelete = (template: CredentialTemplate) => {
    if (confirm(`Are you sure you want to delete "${template.name}"?`)) {
      deleteCustomTemplate(template.id)
      refreshTemplates()
    }
  }

  const handleSave = (
    templateData: Omit<CredentialTemplate, 'id' | 'isBuiltIn' | 'createdAt' | 'updatedAt'>
  ) => {
    if (editorMode === 'create') {
      createCustomTemplate(templateData)
    } else if (editorMode === 'edit' && editingTemplate) {
      updateCustomTemplate(editingTemplate.id, templateData)
    }
    refreshTemplates()
    setEditorOpen(false)
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">
          Create custom templates for faster credential creation
        </p>
        <button onClick={handleCreate} className="btn btn-primary btn-sm flex items-center gap-1">
          <Plus className="w-4 h-4" />
          New Template
        </button>
      </div>

      {/* Custom Templates */}
      {customTemplates.length > 0 ? (
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-gray-700">My Templates</h3>
          {customTemplates.map((template) => (
            <TemplateListItem
              key={template.id}
              template={template}
              useCount={usageStats.get(template.id) || 0}
              onEdit={() => handleEdit(template)}
              onDelete={() => handleDelete(template)}
            />
          ))}
        </div>
      ) : (
        <div className="text-center py-8 border border-dashed border-gray-300 rounded-lg">
          <p className="text-gray-500 mb-2">No custom templates yet</p>
          <button onClick={handleCreate} className="text-primary-600 hover:text-primary-700 text-sm">
            Create your first template
          </button>
        </div>
      )}

      {/* Built-in Templates (Collapsible) */}
      <div className="border-t border-gray-200 pt-4">
        <button
          onClick={() => setShowBuiltIn(!showBuiltIn)}
          className="flex items-center gap-2 text-sm font-medium text-gray-700 hover:text-gray-900"
        >
          {showBuiltIn ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          Built-in Templates ({Object.values(BUILTIN_TEMPLATES_BY_CATEGORY).flat().length})
        </button>

        {showBuiltIn && (
          <div className="mt-3 space-y-4">
            {CATEGORY_ORDER.map((category) => {
              const templates = BUILTIN_TEMPLATES_BY_CATEGORY[category]
              if (templates.length === 0) return null

              return (
                <div key={category}>
                  <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                    {CATEGORY_LABELS[category]}
                  </h4>
                  <div className="space-y-2">
                    {templates.map((template) => (
                      <TemplateListItem
                        key={template.id}
                        template={template}
                        useCount={usageStats.get(template.id) || 0}
                        onView={() => handleView(template)}
                      />
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Editor Dialog */}
      <TemplateEditor
        isOpen={editorOpen}
        onClose={() => setEditorOpen(false)}
        onSave={handleSave}
        initialData={editingTemplate}
        mode={editorMode}
      />
    </div>
  )
}
