/**
 * Template Export/Import Tests
 *
 * Tests for encryption, export, and import functionality.
 * Run with: npm test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  exportTemplates,
  createDownloadUrl,
  readExportFile,
  importTemplates,
  verifyExportPassword,
  getExportMetadata,
} from '@/lib/templateExport'
import { createCustomTemplate, clearAllTemplateData, getCustomTemplates } from '@/lib/templateStorage'
import { EXPORT_FILE_VERSION } from '@/types/template'
import type { ExportFile } from '@/types/template'

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

// Mock crypto.subtle for Node.js environment
// In a real browser environment, this would use the Web Crypto API

describe('Template Export/Import', () => {
  beforeEach(() => {
    localStorageMock.clear()
  })

  describe('exportTemplates', () => {
    it('should export templates with encryption', async () => {
      // Create some templates
      createCustomTemplate({ name: 'Test Template', fields: [{ key: 'API Key', isSecret: true }] })

      const exportFile = await exportTemplates('test-password')

      expect(exportFile.version).toBe(EXPORT_FILE_VERSION)
      expect(exportFile.exportedAt).toBeTruthy()
      expect(exportFile.encryptedData).toBeTruthy()
      expect(exportFile.salt).toBeTruthy()
      expect(exportFile.iv).toBeTruthy()

      // Encrypted data should not contain plaintext template name
      expect(exportFile.encryptedData).not.toContain('Test Template')
    })

    it('should create different ciphertext for same data with different passwords', async () => {
      createCustomTemplate({ name: 'Test', fields: [] })

      const export1 = await exportTemplates('password1')
      const export2 = await exportTemplates('password2')

      expect(export1.encryptedData).not.toBe(export2.encryptedData)
    })
  })

  describe('createDownloadUrl', () => {
    it('should create a blob URL with correct filename', () => {
      const exportFile: ExportFile = {
        version: 1,
        exportedAt: '2025-02-05T00:00:00Z',
        encryptedData: 'test',
        salt: 'test',
        iv: 'test',
      }

      const { url, filename } = createDownloadUrl(exportFile, 'my-templates')

      expect(url).toMatch(/^blob:/)
      expect(filename).toBe('my-templates.cvault')
    })
  })

  describe('readExportFile', () => {
    it('should parse valid export file', async () => {
      const validFile: ExportFile = {
        version: 1,
        exportedAt: '2025-02-05T00:00:00Z',
        encryptedData: 'dGVzdA==',
        salt: 'dGVzdA==',
        iv: 'dGVzdA==',
      }

      const file = new File([JSON.stringify(validFile)], 'test.cvault', {
        type: 'application/json',
      })

      const parsed = await readExportFile(file)

      expect(parsed.version).toBe(1)
      expect(parsed.exportedAt).toBe('2025-02-05T00:00:00Z')
    })

    it('should reject invalid file structure', async () => {
      const invalidFile = new File(['{"invalid": true}'], 'test.cvault', {
        type: 'application/json',
      })

      await expect(readExportFile(invalidFile)).rejects.toThrow('Invalid file structure')
    })

    it('should reject non-JSON file', async () => {
      const invalidFile = new File(['not json'], 'test.cvault', {
        type: 'application/json',
      })

      await expect(readExportFile(invalidFile)).rejects.toThrow('Invalid file format')
    })

    it('should reject incompatible version', async () => {
      const futureVersionFile: ExportFile = {
        version: 999,
        exportedAt: '2025-02-05T00:00:00Z',
        encryptedData: 'test',
        salt: 'test',
        iv: 'test',
      }

      const file = new File([JSON.stringify(futureVersionFile)], 'test.cvault', {
        type: 'application/json',
      })

      await expect(readExportFile(file)).rejects.toThrow('not supported')
    })
  })

  describe('getExportMetadata', () => {
    it('should extract metadata from export file', () => {
      const exportFile: ExportFile = {
        version: 1,
        exportedAt: '2025-02-05T12:00:00Z',
        encryptedData: 'test',
        salt: 'test',
        iv: 'test',
      }

      const metadata = getExportMetadata(exportFile)

      expect(metadata.version).toBe(1)
      expect(metadata.exportedAt).toBeInstanceOf(Date)
      expect(metadata.isCompatible).toBe(true)
    })

    it('should mark incompatible versions', () => {
      const exportFile: ExportFile = {
        version: 999,
        exportedAt: '2025-02-05T12:00:00Z',
        encryptedData: 'test',
        salt: 'test',
        iv: 'test',
      }

      const metadata = getExportMetadata(exportFile)
      expect(metadata.isCompatible).toBe(false)
    })
  })

  describe('verifyExportPassword', () => {
    it('should return true for correct password', async () => {
      createCustomTemplate({ name: 'Test', fields: [] })
      const exportFile = await exportTemplates('correct-password')

      const isValid = await verifyExportPassword(exportFile, 'correct-password')
      expect(isValid).toBe(true)
    })

    it('should return false for incorrect password', async () => {
      createCustomTemplate({ name: 'Test', fields: [] })
      const exportFile = await exportTemplates('correct-password')

      const isValid = await verifyExportPassword(exportFile, 'wrong-password')
      expect(isValid).toBe(false)
    })
  })

  describe('importTemplates', () => {
    it('should import templates with correct password', async () => {
      // Create and export templates
      createCustomTemplate({ name: 'Template A', fields: [{ key: 'Field 1', isSecret: false }] })
      const exportFile = await exportTemplates('test-password')
      const fileContent = JSON.stringify(exportFile)
      const file = new File([fileContent], 'test.cvault', { type: 'application/json' })

      // Clear and import
      clearAllTemplateData()
      const result = await importTemplates(file, 'test-password', 'skip')

      expect(result.success).toBe(true)
      expect(result.imported).toBe(1)

      const templates = getCustomTemplates()
      expect(templates).toHaveLength(1)
      expect(templates[0].name).toBe('Template A')
    })

    it('should fail with incorrect password', async () => {
      createCustomTemplate({ name: 'Test', fields: [] })
      const exportFile = await exportTemplates('correct-password')
      const file = new File([JSON.stringify(exportFile)], 'test.cvault', { type: 'application/json' })

      clearAllTemplateData()
      const result = await importTemplates(file, 'wrong-password', 'skip')

      expect(result.success).toBe(false)
      expect(result.error).toContain('Decryption failed')
    })

    it('should handle skip conflict strategy', async () => {
      // Create original template
      createCustomTemplate({ name: 'Duplicate', fields: [{ key: 'Original', isSecret: false }] })
      const exportFile = await exportTemplates('password')
      const file = new File([JSON.stringify(exportFile)], 'test.cvault', { type: 'application/json' })

      // Create conflicting template
      clearAllTemplateData()
      createCustomTemplate({ name: 'Duplicate', fields: [{ key: 'Existing', isSecret: false }] })

      // Import with skip strategy
      const result = await importTemplates(file, 'password', 'skip')

      expect(result.success).toBe(true)
      expect(result.skipped).toBe(1)
      expect(result.imported).toBe(0)

      // Should keep existing template
      const templates = getCustomTemplates()
      expect(templates[0].fields[0].key).toBe('Existing')
    })

    it('should handle replace conflict strategy', async () => {
      // Create original template
      createCustomTemplate({ name: 'Duplicate', fields: [{ key: 'Original', isSecret: false }] })
      const exportFile = await exportTemplates('password')
      const file = new File([JSON.stringify(exportFile)], 'test.cvault', { type: 'application/json' })

      // Create conflicting template
      clearAllTemplateData()
      createCustomTemplate({ name: 'Duplicate', fields: [{ key: 'Existing', isSecret: false }] })

      // Import with replace strategy
      const result = await importTemplates(file, 'password', 'replace')

      expect(result.success).toBe(true)
      expect(result.replaced).toBe(1)

      // Should have replaced template
      const templates = getCustomTemplates()
      expect(templates[0].fields[0].key).toBe('Original')
    })

    it('should handle keep-both conflict strategy', async () => {
      // Create original template
      createCustomTemplate({ name: 'Duplicate', fields: [{ key: 'Original', isSecret: false }] })
      const exportFile = await exportTemplates('password')
      const file = new File([JSON.stringify(exportFile)], 'test.cvault', { type: 'application/json' })

      // Create conflicting template
      clearAllTemplateData()
      createCustomTemplate({ name: 'Duplicate', fields: [{ key: 'Existing', isSecret: false }] })

      // Import with keep-both strategy
      const result = await importTemplates(file, 'password', 'keep-both')

      expect(result.success).toBe(true)
      expect(result.imported).toBe(1)

      // Should have both templates
      const templates = getCustomTemplates()
      expect(templates).toHaveLength(2)
      expect(templates.some((t) => t.name === 'Duplicate')).toBe(true)
      expect(templates.some((t) => t.name === 'Duplicate (imported)')).toBe(true)
    })
  })

  describe('Round-trip export/import', () => {
    it('should preserve template data through export and import', async () => {
      // Create templates with various fields
      createCustomTemplate({
        name: 'Complex Template',
        description: 'A template with multiple fields',
        icon: '🔐',
        category: 'development',
        fields: [
          { key: 'API Key', isSecret: true, required: true },
          { key: 'Username', isSecret: false, required: true },
          { key: 'Optional Field', isSecret: false, required: false },
        ],
      })

      // Export
      const exportFile = await exportTemplates('secure-password-123')
      const fileContent = JSON.stringify(exportFile)
      const file = new File([fileContent], 'test.cvault', { type: 'application/json' })

      // Clear and import
      clearAllTemplateData()
      const result = await importTemplates(file, 'secure-password-123', 'skip')

      expect(result.success).toBe(true)

      // Verify data integrity
      const templates = getCustomTemplates()
      expect(templates).toHaveLength(1)

      const imported = templates[0]
      expect(imported.name).toBe('Complex Template')
      expect(imported.description).toBe('A template with multiple fields')
      expect(imported.icon).toBe('🔐')
      expect(imported.fields).toHaveLength(3)
      expect(imported.fields[0].key).toBe('API Key')
      expect(imported.fields[0].isSecret).toBe(true)
    })
  })
})
