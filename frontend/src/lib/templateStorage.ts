/**
 * Template Storage Utilities
 *
 * Handles localStorage operations for custom templates and usage tracking.
 * Built-in templates are not stored here - they come from templates.ts.
 */

import type {
  CredentialTemplate,
  TemplateUsage,
  TemplateUsageStats,
  TemplateStorageData,
  SyncRequest,
  SyncTemplateItem,
  SyncUsageItem,
} from '@/types/template'
import {
  TEMPLATE_STORAGE_VERSION,
  TEMPLATE_STORAGE_KEYS,
} from '@/types/template'
import { BUILTIN_TEMPLATES, getBuiltInTemplate } from '@/data/templates'

// =============================================================================
// Constants
// =============================================================================

/** Approximate localStorage limit (5MB). We warn at 80% usage. */
const STORAGE_WARNING_THRESHOLD = 4 * 1024 * 1024 // 4MB

/** Maximum number of usage records to keep */
const MAX_USAGE_RECORDS = 1000

// =============================================================================
// Storage Initialization
// =============================================================================

/**
 * Get default empty storage data.
 */
function getDefaultStorageData(): TemplateStorageData {
  return {
    customTemplates: [],
    usage: [],
    version: TEMPLATE_STORAGE_VERSION,
  }
}

/**
 * Load template data from localStorage.
 * Returns default data if nothing stored or on error.
 */
export function loadTemplateData(): TemplateStorageData {
  try {
    const raw = localStorage.getItem(TEMPLATE_STORAGE_KEYS.DATA)
    if (!raw) {
      return getDefaultStorageData()
    }

    const data = JSON.parse(raw) as TemplateStorageData

    // Version migration could happen here in the future
    if (data.version !== TEMPLATE_STORAGE_VERSION) {
      console.warn(`Template storage version mismatch: ${data.version} vs ${TEMPLATE_STORAGE_VERSION}`)
      // For now, just use the data as-is
    }

    return {
      customTemplates: data.customTemplates || [],
      usage: data.usage || [],
      version: data.version || TEMPLATE_STORAGE_VERSION,
    }
  } catch (error) {
    console.error('Failed to load template data:', error)
    return getDefaultStorageData()
  }
}

/**
 * Save template data to localStorage.
 * Returns true on success, false on failure (e.g., quota exceeded).
 */
export function saveTemplateData(data: TemplateStorageData): boolean {
  try {
    const json = JSON.stringify(data)
    localStorage.setItem(TEMPLATE_STORAGE_KEYS.DATA, json)
    return true
  } catch (error) {
    console.error('Failed to save template data:', error)
    // Likely quota exceeded
    return false
  }
}

// =============================================================================
// Custom Template CRUD
// =============================================================================

/**
 * Generate a unique ID for a custom template.
 */
export function generateCustomTemplateId(): string {
  const uuid = crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `custom-${uuid}`
}

/**
 * Get all custom templates.
 */
export function getCustomTemplates(): CredentialTemplate[] {
  const data = loadTemplateData()
  return data.customTemplates
}

/**
 * Get a custom template by ID.
 */
export function getCustomTemplate(id: string): CredentialTemplate | undefined {
  const data = loadTemplateData()
  return data.customTemplates.find(t => t.id === id)
}

/**
 * Get any template by ID (built-in or custom).
 */
export function getTemplate(id: string): CredentialTemplate | undefined {
  // First check built-in templates
  const builtIn = getBuiltInTemplate(id)
  if (builtIn) return builtIn

  // Then check custom templates
  return getCustomTemplate(id)
}

/**
 * Get all templates (built-in + custom).
 */
export function getAllTemplates(): CredentialTemplate[] {
  const customTemplates = getCustomTemplates()
  return [...BUILTIN_TEMPLATES, ...customTemplates]
}

/**
 * Create a new custom template.
 * Returns the created template on success, null on failure.
 */
export function createCustomTemplate(
  template: Omit<CredentialTemplate, 'id' | 'isBuiltIn' | 'createdAt' | 'updatedAt'>
): CredentialTemplate | null {
  const data = loadTemplateData()

  const newTemplate: CredentialTemplate = {
    ...template,
    id: generateCustomTemplateId(),
    isBuiltIn: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }

  data.customTemplates.push(newTemplate)

  if (!saveTemplateData(data)) {
    return null
  }

  return newTemplate
}

/**
 * Update an existing custom template.
 * Returns true on success, false on failure (not found or save failed).
 */
export function updateCustomTemplate(
  id: string,
  updates: Partial<Omit<CredentialTemplate, 'id' | 'isBuiltIn' | 'createdAt'>>
): boolean {
  const data = loadTemplateData()
  const index = data.customTemplates.findIndex(t => t.id === id)

  if (index === -1) {
    console.error(`Template not found: ${id}`)
    return false
  }

  data.customTemplates[index] = {
    ...data.customTemplates[index],
    ...updates,
    updatedAt: new Date().toISOString(),
  }

  return saveTemplateData(data)
}

/**
 * Delete a custom template.
 * Returns true on success, false on failure.
 */
export function deleteCustomTemplate(id: string): boolean {
  const data = loadTemplateData()
  const index = data.customTemplates.findIndex(t => t.id === id)

  if (index === -1) {
    console.error(`Template not found: ${id}`)
    return false
  }

  data.customTemplates.splice(index, 1)

  // Also remove usage records for this template
  data.usage = data.usage.filter(u => u.templateId !== id)

  return saveTemplateData(data)
}

// =============================================================================
// Usage Tracking
// =============================================================================

/**
 * Record that a template was used to create a credential.
 */
export function recordTemplateUsage(templateId: string, credentialId?: string): boolean {
  const data = loadTemplateData()

  const usage: TemplateUsage = {
    templateId,
    usedAt: new Date().toISOString(),
    credentialId,
  }

  data.usage.push(usage)

  // Trim old records if exceeding limit
  if (data.usage.length > MAX_USAGE_RECORDS) {
    data.usage = data.usage.slice(-MAX_USAGE_RECORDS)
  }

  return saveTemplateData(data)
}

/**
 * Get usage statistics for a specific template.
 */
export function getTemplateUsageStats(templateId: string): TemplateUsageStats {
  const data = loadTemplateData()
  const usages = data.usage.filter(u => u.templateId === templateId)

  return {
    templateId,
    useCount: usages.length,
    lastUsedAt: usages.length > 0 ? usages[usages.length - 1].usedAt : null,
  }
}

/**
 * Get usage statistics for all templates.
 */
export function getAllUsageStats(): Map<string, TemplateUsageStats> {
  const data = loadTemplateData()
  const stats = new Map<string, TemplateUsageStats>()

  // Initialize stats for all templates
  for (const template of getAllTemplates()) {
    stats.set(template.id, {
      templateId: template.id,
      useCount: 0,
      lastUsedAt: null,
    })
  }

  // Count usages
  for (const usage of data.usage) {
    const existing = stats.get(usage.templateId)
    if (existing) {
      existing.useCount++
      existing.lastUsedAt = usage.usedAt
    }
  }

  return stats
}

/**
 * Get templates sorted by usage (most used first, unused last).
 * Templates with same usage count are sorted by last used time.
 */
export function getTemplatesSortedByUsage(): CredentialTemplate[] {
  const templates = getAllTemplates()
  const stats = getAllUsageStats()

  return templates.sort((a, b) => {
    const statsA = stats.get(a.id)
    const statsB = stats.get(b.id)

    // Never used templates go last
    if (!statsA?.useCount && statsB?.useCount) return 1
    if (statsA?.useCount && !statsB?.useCount) return -1

    // Both used: sort by count (descending)
    if (statsA?.useCount !== statsB?.useCount) {
      return (statsB?.useCount || 0) - (statsA?.useCount || 0)
    }

    // Same count: sort by last used (most recent first)
    if (statsA?.lastUsedAt && statsB?.lastUsedAt) {
      return statsB.lastUsedAt.localeCompare(statsA.lastUsedAt)
    }

    return 0
  })
}

/**
 * Get all usage records (for export).
 */
export function getAllUsageRecords(): TemplateUsage[] {
  const data = loadTemplateData()
  return data.usage
}

// =============================================================================
// Storage Utilities
// =============================================================================

/**
 * Check if storage is nearing capacity.
 * Returns { warning: boolean, usedBytes: number, message?: string }
 */
export function checkStorageCapacity(): {
  warning: boolean
  usedBytes: number
  message?: string
} {
  try {
    const raw = localStorage.getItem(TEMPLATE_STORAGE_KEYS.DATA) || ''
    const usedBytes = new Blob([raw]).size

    if (usedBytes >= STORAGE_WARNING_THRESHOLD) {
      return {
        warning: true,
        usedBytes,
        message: `Storage is ${Math.round(usedBytes / 1024 / 1024 * 100) / 100}MB. Consider exporting your templates.`,
      }
    }

    return { warning: false, usedBytes }
  } catch {
    return { warning: false, usedBytes: 0 }
  }
}

/**
 * Clear all template data (custom templates and usage).
 * Use with caution!
 */
export function clearAllTemplateData(): boolean {
  try {
    localStorage.removeItem(TEMPLATE_STORAGE_KEYS.DATA)
    return true
  } catch (error) {
    console.error('Failed to clear template data:', error)
    return false
  }
}

/**
 * Import templates and usage from exported data.
 * Used by the import feature.
 */
export function importTemplateData(
  templates: CredentialTemplate[],
  usage: TemplateUsage[],
  conflictStrategy: 'skip' | 'replace' | 'keep-both' = 'skip'
): { imported: number; skipped: number; replaced: number } {
  const data = loadTemplateData()
  const result = { imported: 0, skipped: 0, replaced: 0 }

  for (const template of templates) {
    // Skip built-in templates
    if (template.isBuiltIn) continue

    const existingIndex = data.customTemplates.findIndex(
      t => t.name.toLowerCase() === template.name.toLowerCase()
    )

    if (existingIndex !== -1) {
      // Conflict found
      switch (conflictStrategy) {
        case 'skip':
          result.skipped++
          continue
        case 'replace':
          data.customTemplates[existingIndex] = {
            ...template,
            updatedAt: new Date().toISOString(),
          }
          result.replaced++
          break
        case 'keep-both': {
          // Add with modified name
          const newTemplate = {
            ...template,
            id: generateCustomTemplateId(),
            name: `${template.name} (imported)`,
            updatedAt: new Date().toISOString(),
          }
          data.customTemplates.push(newTemplate)
          result.imported++
          break
        }
      }
    } else {
      // No conflict - add new template
      const newTemplate = {
        ...template,
        id: generateCustomTemplateId(), // Generate new ID
        updatedAt: new Date().toISOString(),
      }
      data.customTemplates.push(newTemplate)
      result.imported++
    }
  }

  // Import usage records (append, don't replace)
  data.usage = [...data.usage, ...usage].slice(-MAX_USAGE_RECORDS)

  saveTemplateData(data)
  return result
}

// =============================================================================
// Migration Utilities (Phase 3 - Backend Sync)
// =============================================================================

/** Key to track if migration has been completed */
const MIGRATION_COMPLETED_KEY = 'credential-vault-templates-migrated'

/**
 * Check if localStorage has custom templates that need migration.
 */
export function hasLocalTemplates(): boolean {
  const data = loadTemplateData()
  return data.customTemplates.length > 0
}

/**
 * Check if migration to backend has already been completed.
 */
export function isMigrationCompleted(): boolean {
  try {
    return localStorage.getItem(MIGRATION_COMPLETED_KEY) === 'true'
  } catch {
    return false
  }
}

/**
 * Mark migration as completed.
 */
export function markMigrationCompleted(): void {
  try {
    localStorage.setItem(MIGRATION_COMPLETED_KEY, 'true')
  } catch (error) {
    console.error('Failed to mark migration as completed:', error)
  }
}

/**
 * Prepare localStorage data for sync to backend.
 * Converts localStorage format to API sync request format.
 */
export function prepareSyncRequest(): SyncRequest {
  const data = loadTemplateData()

  const templates: SyncTemplateItem[] = data.customTemplates.map(t => ({
    local_id: t.id,
    name: t.name,
    description: t.description,
    icon: t.icon,
    category: t.category,
    fields: t.fields,
    created_at: t.createdAt,
  }))

  const usage: SyncUsageItem[] = data.usage
    .filter(u => u.templateId.startsWith('custom-')) // Only custom template usage
    .map(u => ({
      local_template_id: u.templateId,
      used_at: u.usedAt,
    }))

  return { templates, usage }
}

/**
 * Clear localStorage templates after successful migration.
 * Keeps usage stats for built-in templates.
 */
export function clearLocalTemplatesAfterMigration(): void {
  const data = loadTemplateData()

  // Keep only built-in template usage
  data.customTemplates = []
  data.usage = data.usage.filter(u => u.templateId.startsWith('builtin-'))

  saveTemplateData(data)
  markMigrationCompleted()
}

/**
 * Check if migration is needed.
 * Returns true if:
 * - localStorage has custom templates
 * - Migration hasn't been completed yet
 */
export function needsMigration(): boolean {
  return hasLocalTemplates() && !isMigrationCompleted()
}
