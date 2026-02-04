/**
 * Template Selector Component
 *
 * Modal dialog for selecting a credential template.
 * Features:
 * - Grouped by category
 * - Search/filter functionality
 * - Usage count display
 * - Used templates sorted to bottom
 * - "Start from Scratch" option
 */

import { useState, useMemo } from 'react'
import { X, Search, FileText, Sparkles } from 'lucide-react'
import type { CredentialTemplate, TemplateCategory } from '@/types/template'
import { BUILTIN_TEMPLATES_BY_CATEGORY, CATEGORY_LABELS, CATEGORY_ORDER } from '@/data/templates'
import { getCustomTemplates, getAllUsageStats } from '@/lib/templateStorage'

interface TemplateSelectorProps {
  isOpen: boolean
  onClose: () => void
  onSelect: (template: CredentialTemplate | null) => void
}

/**
 * Template card component for displaying a single template option.
 */
function TemplateCard({
  template,
  useCount,
  onClick,
}: {
  template: CredentialTemplate
  useCount: number
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center p-3 rounded-lg border border-gray-200 hover:border-primary-300 hover:bg-primary-50 transition-colors text-center group w-full"
    >
      <span className="text-2xl mb-1">{template.icon || '📄'}</span>
      <span className="text-sm font-medium text-gray-900 group-hover:text-primary-700 line-clamp-1">
        {template.name}
      </span>
      {useCount > 0 && (
        <span className="text-xs text-gray-400 mt-0.5">
          Used {useCount}x
        </span>
      )}
    </button>
  )
}

/**
 * Category section component for displaying a group of templates.
 */
function CategorySection({
  category,
  templates,
  usageStats,
  onSelect,
}: {
  category: TemplateCategory
  templates: CredentialTemplate[]
  usageStats: Map<string, { useCount: number }>
  onSelect: (template: CredentialTemplate) => void
}) {
  if (templates.length === 0) return null

  return (
    <div className="mb-6">
      <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
        {CATEGORY_LABELS[category]}
      </h3>
      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
        {templates.map((template) => (
          <TemplateCard
            key={template.id}
            template={template}
            useCount={usageStats.get(template.id)?.useCount || 0}
            onClick={() => onSelect(template)}
          />
        ))}
      </div>
    </div>
  )
}

export default function TemplateSelector({
  isOpen,
  onClose,
  onSelect,
}: TemplateSelectorProps) {
  const [searchQuery, setSearchQuery] = useState('')

  // Get all templates and usage stats
  const { templatesByCategory, customTemplates, usageStats } = useMemo(() => {
    const stats = getAllUsageStats()
    const custom = getCustomTemplates()

    // Sort templates within each category: unused first, then by use count (ascending)
    const sortByUsage = (templates: CredentialTemplate[]) => {
      return [...templates].sort((a, b) => {
        const countA = stats.get(a.id)?.useCount || 0
        const countB = stats.get(b.id)?.useCount || 0

        // Unused templates first
        if (countA === 0 && countB > 0) return -1
        if (countA > 0 && countB === 0) return 1

        // Among used templates, sort by count ascending (less used first)
        return countA - countB
      })
    }

    const sorted: Record<TemplateCategory, CredentialTemplate[]> = {} as Record<TemplateCategory, CredentialTemplate[]>
    for (const category of CATEGORY_ORDER) {
      sorted[category] = sortByUsage(BUILTIN_TEMPLATES_BY_CATEGORY[category] || [])
    }

    return {
      templatesByCategory: sorted,
      customTemplates: sortByUsage(custom),
      usageStats: stats,
    }
  }, [])

  // Filter templates by search query
  const filteredTemplates = useMemo(() => {
    const query = searchQuery.toLowerCase().trim()
    if (!query) {
      return { byCategory: templatesByCategory, custom: customTemplates }
    }

    const filterTemplates = (templates: CredentialTemplate[]) =>
      templates.filter(
        (t) =>
          t.name.toLowerCase().includes(query) ||
          t.description?.toLowerCase().includes(query) ||
          t.fields.some((f) => f.key.toLowerCase().includes(query))
      )

    const filtered: Record<TemplateCategory, CredentialTemplate[]> = {} as Record<TemplateCategory, CredentialTemplate[]>
    for (const category of CATEGORY_ORDER) {
      filtered[category] = filterTemplates(templatesByCategory[category])
    }

    return {
      byCategory: filtered,
      custom: filterTemplates(customTemplates),
    }
  }, [searchQuery, templatesByCategory, customTemplates])

  // Check if any templates match the search
  const hasResults = useMemo(() => {
    const builtInCount = CATEGORY_ORDER.reduce(
      (sum, cat) => sum + filteredTemplates.byCategory[cat].length,
      0
    )
    return builtInCount > 0 || filteredTemplates.custom.length > 0
  }, [filteredTemplates])

  const handleSelect = (template: CredentialTemplate) => {
    onSelect(template)
    onClose()
  }

  const handleStartFromScratch = () => {
    onSelect(null)
    onClose()
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl m-4 max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Choose a Template</h2>
            <p className="text-sm text-gray-500">
              Select a template to quickly create a credential
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search */}
        <div className="p-4 border-b border-gray-200">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search templates..."
              className="input pl-10"
              autoFocus
            />
          </div>
        </div>

        {/* Template List */}
        <div className="flex-1 overflow-y-auto p-4">
          {/* Start from Scratch - Always visible at top */}
          <div className="mb-6">
            <button
              onClick={handleStartFromScratch}
              className="w-full flex items-center gap-3 p-4 rounded-lg border-2 border-dashed border-gray-300 hover:border-primary-400 hover:bg-primary-50 transition-colors group"
            >
              <div className="flex items-center justify-center w-10 h-10 rounded-full bg-gray-100 group-hover:bg-primary-100">
                <Sparkles className="w-5 h-5 text-gray-500 group-hover:text-primary-600" />
              </div>
              <div className="text-left">
                <div className="font-medium text-gray-900 group-hover:text-primary-700">
                  Start from Scratch
                </div>
                <div className="text-sm text-gray-500">
                  Create a credential with custom fields
                </div>
              </div>
            </button>
          </div>

          {/* No results message */}
          {!hasResults && searchQuery && (
            <div className="text-center py-8">
              <FileText className="w-12 h-12 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500">No templates found for "{searchQuery}"</p>
              <button
                onClick={handleStartFromScratch}
                className="text-primary-600 hover:text-primary-700 text-sm mt-2"
              >
                Start from scratch instead
              </button>
            </div>
          )}

          {/* Custom Templates */}
          {filteredTemplates.custom.length > 0 && (
            <div className="mb-6">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
                My Templates
              </h3>
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                {filteredTemplates.custom.map((template) => (
                  <TemplateCard
                    key={template.id}
                    template={template}
                    useCount={usageStats.get(template.id)?.useCount || 0}
                    onClick={() => handleSelect(template)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Built-in Templates by Category */}
          {CATEGORY_ORDER.map((category) => (
            <CategorySection
              key={category}
              category={category}
              templates={filteredTemplates.byCategory[category]}
              usageStats={usageStats}
              onSelect={handleSelect}
            />
          ))}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-200 bg-gray-50 rounded-b-xl">
          <p className="text-xs text-gray-500 text-center">
            Templates help you create credentials faster. Your custom templates are stored locally in this browser.
          </p>
        </div>
      </div>
    </div>
  )
}
