/**
 * Form field attributes: what React renders for the shared attribute sets,
 * and a source scan that every text field in the app declares one.
 */

import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { secretFieldProps, privateFieldProps } from '@/lib/inputProps'

const sources = import.meta.glob<string>(['../**/*.tsx', '!../__tests__/**'], {
  query: '?raw',
  import: 'default',
  eager: true,
})

// Files whose password fields are the account's own login password.
const ACCOUNT_FORMS = [
  'pages/AdminSetupPage.tsx',
  'pages/AdminLoginPage.tsx',
  'components/PasswordVerifyModal.tsx',
  'components/AdminPasswordSetup.tsx',
]

// Types where autocomplete and spell checking do not apply.
const NON_TEXT_TYPES = /type="(checkbox|radio|range|file|hidden)"/

interface Field {
  file: string
  tag: string
  source: string
}

/** type="password", or a show/hide toggle such as type={show ? 'text' : 'password'}. */
function isPasswordField(field: Field): boolean {
  return /password/.test(field.source.match(/type=(\{[^}]*\}|"[^"]*")/)?.[1] ?? '')
}

/** Every <input> / <textarea> element, cut at its closing > (skipping JSX expressions). */
function findFields(): Field[] {
  const fields: Field[] = []
  for (const [path, source] of Object.entries(sources)) {
    const file = path.replace(/^\.\.\//, '')
    for (const match of source.matchAll(/<(input|textarea)\b/g)) {
      let depth = 0
      let end = match.index
      for (; end < source.length; end++) {
        const ch = source[end]
        if (ch === '{') depth++
        else if (ch === '}') depth--
        else if (ch === '>' && depth === 0) break
      }
      fields.push({ file, tag: match[1], source: source.slice(match.index, end + 1) })
    }
  }
  return fields
}

describe('shared field attributes', () => {
  it('render the opt-outs on a secret input', () => {
    const html = renderToStaticMarkup(<input type="password" {...secretFieldProps} />)
    for (const attr of [
      'autoComplete="off"',
      'spellCheck="false"',
      'autoCapitalize="off"',
      'autoCorrect="off"',
      'data-1p-ignore="true"',
      'data-lpignore="true"',
      'data-bwignore="true"',
      'data-form-type="other"',
      'data-gramm="false"',
    ]) {
      expect(html).toContain(attr)
    }
  })

  it('turn spell checking off on a textarea, which browsers check by default', () => {
    const html = renderToStaticMarkup(<textarea {...secretFieldProps} />)
    expect(html).toContain('spellCheck="false"')
  })

  it('keep private text out of autofill and cloud spell checking', () => {
    const html = renderToStaticMarkup(<input type="text" {...privateFieldProps} />)
    expect(html).toContain('autoComplete="off"')
    expect(html).toContain('spellCheck="false"')
    expect(html).toContain('data-gramm="false"')
  })
})

describe('every text field declares how browsers may treat it', () => {
  const fields = findFields().filter((field) => !NON_TEXT_TYPES.test(field.source))

  it('finds the app forms', () => {
    expect(fields.length).toBeGreaterThan(25)
  })

  it('uses a shared attribute set or an explicit autocomplete token', () => {
    const undeclared = fields.filter(
      (field) =>
        !/\{\.\.\.(secretFieldProps|privateFieldProps)\}/.test(field.source) &&
        !/autoComplete="/.test(field.source),
    )
    expect(undeclared.map((field) => `${field.file}: ${field.source.slice(0, 80)}`)).toEqual([])
  })

  it('treats every non-account password field and every textarea as a secret', () => {
    const exposed = fields.filter((field) => {
      const mustBeSecret =
        field.tag === 'textarea' || (isPasswordField(field) && !ACCOUNT_FORMS.includes(field.file))
      return mustBeSecret && !field.source.includes('{...secretFieldProps}')
    })
    expect(exposed.map((field) => `${field.file}: ${field.source.slice(0, 80)}`)).toEqual([])
  })

  it('gives account password fields the standard tokens', () => {
    const accountPasswords = fields.filter(
      (field) => ACCOUNT_FORMS.includes(field.file) && isPasswordField(field),
    )
    expect(accountPasswords.length).toBe(6)
    for (const field of accountPasswords) {
      expect(field.source).toMatch(/autoComplete="(new-password|current-password)"/)
    }
  })
})
