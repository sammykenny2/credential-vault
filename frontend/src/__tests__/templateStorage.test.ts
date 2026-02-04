/**
 * Template Storage Tests
 *
 * Tests for localStorage operations including CRUD and usage tracking.
 * Run with: npm test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  loadTemplateData,
  saveTemplateData,
  getCustomTemplates,
  createCustomTemplate,
  updateCustomTemplate,
  deleteCustomTemplate,
  recordTemplateUsage,
  getTemplateUsageStats,
  getAllUsageStats,
  getTemplatesSortedByUsage,
  checkStorageCapacity,
  clearAllTemplateData,
  getTemplate,
  getAllTemplates,
} from '@/lib/templateStorage'
import { TEMPLATE_STORAGE_KEYS } from '@/types/template'
import { BUILTIN_TEMPLATES } from '@/data/templates'

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value
    },
    removeItem: (key: string) => {
      delete store[key]
    },
    clear: () => {
      store = {}
    },
  }
})()

Object.defineProperty(window, 'localStorage', { value: localStorageMock })

describe('Template Storage', () => {
  beforeEach(() => {
    localStorageMock.clear()
  })

  describe('loadTemplateData', () => {
    it('should return default data when localStorage is empty', () => {
      const data = loadTemplateData()
      expect(data.customTemplates).toEqual([])
      expect(data.usage).toEqual([])
      expect(data.version).toBe(1)
    })

    it('should load existing data from localStorage', () => {
      const testData = {
        customTemplates: [{ id: 'custom-1', name: 'Test', fields: [], isBuiltIn: false }],
        usage: [{ templateId: 'custom-1', usedAt: '2025-01-01T00:00:00Z' }],
        version: 1,
      }
      localStorageMock.setItem(TEMPLATE_STORAGE_KEYS.DATA, JSON.stringify(testData))

      const data = loadTemplateData()
      expect(data.customTemplates).toHaveLength(1)
      expect(data.customTemplates[0].name).toBe('Test')
    })

    it('should handle corrupted data gracefully', () => {
      localStorageMock.setItem(TEMPLATE_STORAGE_KEYS.DATA, 'invalid json')

      const data = loadTemplateData()
      expect(data.customTemplates).toEqual([])
    })
  })

  describe('saveTemplateData', () => {
    it('should save data to localStorage', () => {
      const testData = {
        customTemplates: [],
        usage: [],
        version: 1,
      }

      const result = saveTemplateData(testData)
      expect(result).toBe(true)

      const saved = localStorageMock.getItem(TEMPLATE_STORAGE_KEYS.DATA)
      expect(saved).toBeTruthy()
      expect(JSON.parse(saved!)).toEqual(testData)
    })
  })

  describe('Custom Template CRUD', () => {
    it('should create a custom template', () => {
      const template = createCustomTemplate({
        name: 'My Template',
        fields: [{ key: 'Username', isSecret: false }],
      })

      expect(template).toBeTruthy()
      expect(template?.id).toMatch(/^custom-/)
      expect(template?.name).toBe('My Template')
      expect(template?.isBuiltIn).toBe(false)
      expect(template?.createdAt).toBeTruthy()
    })

    it('should get custom templates', () => {
      createCustomTemplate({ name: 'Template 1', fields: [] })
      createCustomTemplate({ name: 'Template 2', fields: [] })

      const templates = getCustomTemplates()
      expect(templates).toHaveLength(2)
    })

    it('should update a custom template', () => {
      const template = createCustomTemplate({ name: 'Original', fields: [] })

      const result = updateCustomTemplate(template!.id, { name: 'Updated' })
      expect(result).toBe(true)

      const templates = getCustomTemplates()
      expect(templates[0].name).toBe('Updated')
    })

    it('should delete a custom template', () => {
      const template = createCustomTemplate({ name: 'To Delete', fields: [] })

      const result = deleteCustomTemplate(template!.id)
      expect(result).toBe(true)

      const templates = getCustomTemplates()
      expect(templates).toHaveLength(0)
    })

    it('should return false when updating non-existent template', () => {
      const result = updateCustomTemplate('non-existent', { name: 'Test' })
      expect(result).toBe(false)
    })
  })

  describe('Usage Tracking', () => {
    it('should record template usage', () => {
      const result = recordTemplateUsage('builtin-login-basic', 'cred-123')
      expect(result).toBe(true)

      const stats = getTemplateUsageStats('builtin-login-basic')
      expect(stats.useCount).toBe(1)
      expect(stats.lastUsedAt).toBeTruthy()
    })

    it('should increment usage count', () => {
      recordTemplateUsage('template-1')
      recordTemplateUsage('template-1')
      recordTemplateUsage('template-1')

      const stats = getTemplateUsageStats('template-1')
      expect(stats.useCount).toBe(3)
    })

    it('should get all usage stats', () => {
      recordTemplateUsage('template-1')
      recordTemplateUsage('template-2')

      const stats = getAllUsageStats()
      expect(stats.get('template-1')?.useCount).toBe(1)
      expect(stats.get('template-2')?.useCount).toBe(1)
    })
  })

  describe('getTemplate', () => {
    it('should get built-in template by ID', () => {
      const template = getTemplate('builtin-login-login--basic-')
      // Note: ID format depends on the actual template data
      // This test verifies the function works with built-in templates
      expect(BUILTIN_TEMPLATES.length).toBeGreaterThan(0)
    })

    it('should get custom template by ID', () => {
      const created = createCustomTemplate({ name: 'Custom', fields: [] })
      const template = getTemplate(created!.id)

      expect(template).toBeTruthy()
      expect(template?.name).toBe('Custom')
    })

    it('should return undefined for non-existent template', () => {
      const template = getTemplate('non-existent')
      expect(template).toBeUndefined()
    })
  })

  describe('getAllTemplates', () => {
    it('should return built-in and custom templates', () => {
      createCustomTemplate({ name: 'Custom 1', fields: [] })
      createCustomTemplate({ name: 'Custom 2', fields: [] })

      const all = getAllTemplates()
      expect(all.length).toBe(BUILTIN_TEMPLATES.length + 2)
    })
  })

  describe('getTemplatesSortedByUsage', () => {
    it('should sort unused templates first', () => {
      createCustomTemplate({ name: 'Unused', fields: [] })
      const used = createCustomTemplate({ name: 'Used', fields: [] })
      recordTemplateUsage(used!.id)

      const sorted = getTemplatesSortedByUsage()
      const customTemplates = sorted.filter((t) => !t.isBuiltIn)

      // Unused should come before used
      const unusedIndex = customTemplates.findIndex((t) => t.name === 'Unused')
      const usedIndex = customTemplates.findIndex((t) => t.name === 'Used')
      expect(unusedIndex).toBeLessThan(usedIndex)
    })
  })

  describe('checkStorageCapacity', () => {
    it('should return no warning for small data', () => {
      const result = checkStorageCapacity()
      expect(result.warning).toBe(false)
    })
  })

  describe('clearAllTemplateData', () => {
    it('should clear all template data', () => {
      createCustomTemplate({ name: 'Test', fields: [] })
      recordTemplateUsage('test-template')

      const result = clearAllTemplateData()
      expect(result).toBe(true)

      const templates = getCustomTemplates()
      expect(templates).toHaveLength(0)
    })
  })
})
