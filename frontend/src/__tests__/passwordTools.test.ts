/**
 * Tests for the client-side password tools (generation, strength, breach check).
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  randomInt,
  generatePassword,
  generatePassphrase,
  analyzePassword,
  checkPasswordBreach,
  WORDLIST,
} from '@/lib/passwordTools'

const UPPER = /[A-Z]/
const LOWER = /[a-z]/
const DIGIT = /[0-9]/
const SYMBOL = /[!@#$%^&*()\-_=+[\]{}|;:,.<>?]/

describe('randomInt', () => {
  it('stays within [0, max)', () => {
    for (let i = 0; i < 500; i++) {
      const v = randomInt(7)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(7)
      expect(Number.isInteger(v)).toBe(true)
    }
  })

  it('returns 0 for max 1', () => {
    expect(randomInt(1)).toBe(0)
  })

  it('rejects invalid bounds', () => {
    expect(() => randomInt(0)).toThrow(RangeError)
    expect(() => randomInt(-3)).toThrow(RangeError)
    expect(() => randomInt(2.5)).toThrow(RangeError)
  })
})

describe('generatePassword', () => {
  it('defaults to 20 characters with every class present', () => {
    const pw = generatePassword()
    expect(pw).toHaveLength(20)
    expect(pw).toMatch(UPPER)
    expect(pw).toMatch(LOWER)
    expect(pw).toMatch(DIGIT)
    expect(pw).toMatch(SYMBOL)
  })

  it('clamps length to 8..128', () => {
    expect(generatePassword({ length: 2 })).toHaveLength(8)
    expect(generatePassword({ length: 500 })).toHaveLength(128)
  })

  it('honours disabled classes', () => {
    const pw = generatePassword({ length: 32, symbols: false, digits: false })
    expect(pw).not.toMatch(SYMBOL)
    expect(pw).not.toMatch(DIGIT)
    expect(pw).toMatch(UPPER)
    expect(pw).toMatch(LOWER)
  })

  it('falls back to alphanumerics when no class is selected', () => {
    const pw = generatePassword({
      length: 16,
      uppercase: false,
      lowercase: false,
      digits: false,
      symbols: false,
    })
    expect(pw).toHaveLength(16)
    expect(pw).toMatch(/^[A-Za-z0-9]+$/)
  })

  it('excludes ambiguous characters when asked', () => {
    for (let i = 0; i < 20; i++) {
      const pw = generatePassword({ length: 64, excludeAmbiguous: true })
      expect(pw).not.toMatch(/[0O1lI]/)
    }
  })

  it('produces different passwords on each call', () => {
    const seen = new Set(Array.from({ length: 20 }, () => generatePassword()))
    expect(seen.size).toBe(20)
  })
})

describe('generatePassphrase', () => {
  it('joins the requested number of wordlist words', () => {
    const phrase = generatePassphrase({ wordCount: 5 })
    const words = phrase.split('-')
    expect(words).toHaveLength(5)
    for (const w of words) expect(WORDLIST).toContain(w)
  })

  it('clamps word count to 3..10', () => {
    expect(generatePassphrase({ wordCount: 1 }).split('-')).toHaveLength(3)
    expect(generatePassphrase({ wordCount: 99 }).split('-')).toHaveLength(10)
  })

  it('supports separator, capitalize and number', () => {
    const phrase = generatePassphrase({
      wordCount: 4,
      separator: '.',
      capitalize: true,
      includeNumber: true,
    })
    const words = phrase.split('.')
    expect(words).toHaveLength(4)
    for (const w of words) expect(w.charAt(0)).toMatch(UPPER)
    expect(words.filter((w) => /\d+$/.test(w))).toHaveLength(1)
  })
})

describe('analyzePassword', () => {
  it('scores an empty password as very weak', () => {
    const r = analyzePassword('')
    expect(r.score).toBe(0)
    expect(r.level).toBe('very_weak')
    expect(r.crack_time_display).toBe('instant')
  })

  it('caps common passwords at 5', () => {
    const r = analyzePassword('password')
    expect(r.score).toBeLessThanOrEqual(5)
    expect(r.level).toBe('very_weak')
    expect(r.feedback).toContain('This is a commonly used password')
  })

  it('rates a long diverse password as very strong', () => {
    const r = analyzePassword('Xq7!mZ2#pL9$vB4@wN6^')
    expect(r.score).toBeGreaterThanOrEqual(80)
    expect(r.level).toBe('very_strong')
    expect(r.details.has_symbols).toBe(true)
    expect(r.details.length).toBe(20)
  })

  it('flags sequential and keyboard patterns', () => {
    expect(analyzePassword('abcdefgh').feedback).toContain('Avoid sequential characters (abc, 123)')
    expect(analyzePassword('qwertyzz').feedback).toContain('Avoid keyboard patterns (qwerty, asdf)')
  })

  it('flags repeated patterns and single-character passwords', () => {
    expect(analyzePassword('abababab').feedback).toContain('Avoid repeating patterns')
    expect(analyzePassword('aaaaaaaa').feedback).toContain(
      'Password contains only one unique character'
    )
  })

  it('gives actionable feedback for missing classes', () => {
    const r = analyzePassword('lowercaseonly')
    expect(r.feedback).toContain('Add uppercase letters')
    expect(r.feedback).toContain('Add numbers')
    expect(r.feedback).toContain('Add special characters (!@#$%)')
    expect(r.feedback.length).toBeLessThanOrEqual(5)
  })

  it('reports a human readable crack time', () => {
    expect(analyzePassword('aB3$').crack_time_display).toBe('instant')
    expect(analyzePassword('Xq7!mZ2#pL9$vB4@wN6^').crack_time_display).toMatch(/years|centuries/)
  })
})

describe('checkPasswordBreach', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // SHA-1("password") = 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8
  const PREFIX = '5BAA6'
  const SUFFIX = '1E4C9B93F3F0682250B6CF8331B7EE68FD8'

  it('reports a breached password with its count', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toBe(`https://api.pwnedpasswords.com/range/${PREFIX}`)
      return new Response(`0018A45C4D1DEF81644B54AB7F969B88D65:1\n${SUFFIX}:3861493\n`, {
        status: 200,
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const r = await checkPasswordBreach('password')
    expect(r).toEqual({ breached: true, count: 3861493, error: null })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('treats a missing suffix or padded zero-count entry as not breached', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(`${SUFFIX}:0\nABCDEF0123456789ABCDEF0123456789ABC:5\n`))
    )
    const r = await checkPasswordBreach('password')
    expect(r).toEqual({ breached: false, count: 0, error: null })
  })

  it('returns an error instead of throwing when the API fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503 })))
    const r = await checkPasswordBreach('password')
    expect(r.breached).toBe(false)
    expect(r.error).toMatch(/HTTP 503/)

    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    const r2 = await checkPasswordBreach('password')
    expect(r2.breached).toBe(false)
    expect(r2.error).toMatch(/offline/)
  })
})
