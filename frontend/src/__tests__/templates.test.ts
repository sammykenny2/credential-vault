/**
 * Built-in Templates Tests
 *
 * Tests to verify built-in templates are properly structured.
 * Run with: npm test
 */

import { describe, it, expect } from 'vitest'
import {
  BUILTIN_TEMPLATES,
  BUILTIN_TEMPLATES_BY_CATEGORY,
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  getBuiltInTemplate,
  isBuiltInTemplateId,
} from '@/data/templates'
import type { CredentialTemplate, TemplateCategory } from '@/types/template'

describe('Built-in Templates', () => {
  describe('Template Structure Validation', () => {
    it('should have at least 18 built-in templates', () => {
      expect(BUILTIN_TEMPLATES.length).toBeGreaterThanOrEqual(18)
    })

    it('all templates should have required fields', () => {
      for (const template of BUILTIN_TEMPLATES) {
        expect(template.id).toBeTruthy()
        expect(template.name).toBeTruthy()
        expect(template.isBuiltIn).toBe(true)
        expect(Array.isArray(template.fields)).toBe(true)
        expect(template.fields.length).toBeGreaterThan(0)
      }
    })

    it('all templates should have valid IDs', () => {
      for (const template of BUILTIN_TEMPLATES) {
        expect(template.id).toMatch(/^builtin-/)
        expect(isBuiltInTemplateId(template.id)).toBe(true)
      }
    })

    it('all templates should have unique IDs', () => {
      const ids = BUILTIN_TEMPLATES.map((t) => t.id)
      const uniqueIds = new Set(ids)
      expect(uniqueIds.size).toBe(ids.length)
    })

    it('all templates should have unique names', () => {
      const names = BUILTIN_TEMPLATES.map((t) => t.name)
      const uniqueNames = new Set(names)
      expect(uniqueNames.size).toBe(names.length)
    })

    it('all template fields should have key and isSecret', () => {
      for (const template of BUILTIN_TEMPLATES) {
        for (const field of template.fields) {
          expect(field.key).toBeTruthy()
          expect(typeof field.isSecret).toBe('boolean')
        }
      }
    })

    it('all templates should have icons', () => {
      for (const template of BUILTIN_TEMPLATES) {
        expect(template.icon).toBeTruthy()
      }
    })

    it('all templates should have categories', () => {
      for (const template of BUILTIN_TEMPLATES) {
        expect(template.category).toBeTruthy()
        expect(CATEGORY_ORDER).toContain(template.category)
      }
    })
  })

  describe('Category Organization', () => {
    it('should have all categories defined', () => {
      expect(CATEGORY_ORDER.length).toBeGreaterThanOrEqual(7)

      for (const category of CATEGORY_ORDER) {
        expect(CATEGORY_LABELS[category]).toBeTruthy()
        expect(BUILTIN_TEMPLATES_BY_CATEGORY[category]).toBeDefined()
      }
    })

    it('should have templates in each category', () => {
      for (const category of CATEGORY_ORDER) {
        const templates = BUILTIN_TEMPLATES_BY_CATEGORY[category]
        expect(templates.length).toBeGreaterThan(0)
      }
    })

    it('total templates by category should equal BUILTIN_TEMPLATES', () => {
      const totalByCategory = CATEGORY_ORDER.reduce(
        (sum, cat) => sum + BUILTIN_TEMPLATES_BY_CATEGORY[cat].length,
        0
      )
      expect(totalByCategory).toBe(BUILTIN_TEMPLATES.length)
    })

    it('each template should be in the correct category', () => {
      for (const category of CATEGORY_ORDER) {
        const templates = BUILTIN_TEMPLATES_BY_CATEGORY[category]
        for (const template of templates) {
          expect(template.category).toBe(category)
        }
      }
    })
  })

  describe('getBuiltInTemplate', () => {
    it('should find template by ID', () => {
      const firstTemplate = BUILTIN_TEMPLATES[0]
      const found = getBuiltInTemplate(firstTemplate.id)

      expect(found).toBeTruthy()
      expect(found?.name).toBe(firstTemplate.name)
    })

    it('should return undefined for non-existent ID', () => {
      const found = getBuiltInTemplate('builtin-non-existent')
      expect(found).toBeUndefined()
    })

    it('should return undefined for custom template ID', () => {
      const found = getBuiltInTemplate('custom-12345')
      expect(found).toBeUndefined()
    })
  })

  describe('isBuiltInTemplateId', () => {
    it('should return true for builtin IDs', () => {
      expect(isBuiltInTemplateId('builtin-login-basic')).toBe(true)
      expect(isBuiltInTemplateId('builtin-dev-api')).toBe(true)
    })

    it('should return false for custom IDs', () => {
      expect(isBuiltInTemplateId('custom-12345')).toBe(false)
      expect(isBuiltInTemplateId('my-template')).toBe(false)
    })
  })

  describe('Specific Template Categories', () => {
    it('should have login templates', () => {
      const loginTemplates = BUILTIN_TEMPLATES_BY_CATEGORY['login']
      expect(loginTemplates.some((t) => t.name.includes('Login'))).toBe(true)
    })

    it('should have Google templates', () => {
      const googleTemplates = BUILTIN_TEMPLATES_BY_CATEGORY['google']
      expect(googleTemplates.some((t) => t.name.includes('Google'))).toBe(true)
    })

    it('should have development templates', () => {
      const devTemplates = BUILTIN_TEMPLATES_BY_CATEGORY['development']
      expect(devTemplates.length).toBeGreaterThanOrEqual(3)
    })

    it('should have cloud provider templates', () => {
      const cloudTemplates = BUILTIN_TEMPLATES_BY_CATEGORY['cloud']
      expect(cloudTemplates.some((t) => t.name.includes('AWS'))).toBe(true)
    })
  })

  describe('Secret Field Detection', () => {
    it('password fields should be marked as secret', () => {
      for (const template of BUILTIN_TEMPLATES) {
        const passwordFields = template.fields.filter((f) =>
          f.key.toLowerCase().includes('password')
        )
        for (const field of passwordFields) {
          expect(field.isSecret).toBe(true)
        }
      }
    })

    it('secret/key/token fields should be marked as secret', () => {
      for (const template of BUILTIN_TEMPLATES) {
        const sensitiveFields = template.fields.filter(
          (f) =>
            f.key.toLowerCase().includes('secret') ||
            f.key.toLowerCase().includes('private key') ||
            f.key.toLowerCase().includes('token') ||
            f.key.toLowerCase().includes('cvv')
        )
        for (const field of sensitiveFields) {
          expect(field.isSecret).toBe(true)
        }
      }
    })

    it('username/email fields should not be secret', () => {
      for (const template of BUILTIN_TEMPLATES) {
        const nonSecretFields = template.fields.filter(
          (f) =>
            f.key.toLowerCase() === 'username' ||
            f.key.toLowerCase() === 'email' ||
            f.key.toLowerCase().includes('host')
        )
        for (const field of nonSecretFields) {
          expect(field.isSecret).toBe(false)
        }
      }
    })
  })
})
