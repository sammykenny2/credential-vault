/**
 * OAuth state round-trip tests.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  beginOAuthFlow,
  peekOAuthFlow,
  consumeOAuthFlow,
  clearOAuthFlow,
} from '@/lib/oauthState'

describe('oauthState', () => {
  beforeEach(() => {
    sessionStorage.clear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('generates a long random state and remembers the action', () => {
    const state = beginOAuthFlow('login')
    expect(state.length).toBeGreaterThanOrEqual(32)
    expect(state).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(peekOAuthFlow()).toMatchObject({ state, action: 'login' })
    expect(beginOAuthFlow('link')).not.toBe(state)
  })

  it('does not touch localStorage', () => {
    beginOAuthFlow('login')
    expect(localStorage.length).toBe(0)
  })

  it('consume returns the flow only for the exact state and clears it', () => {
    const state = beginOAuthFlow('link')
    expect(consumeOAuthFlow(state)).toMatchObject({ action: 'link' })
    // Second use fails: single-use
    expect(consumeOAuthFlow(state)).toBeNull()
  })

  it('consume rejects a different or missing state and still clears the flow', () => {
    beginOAuthFlow('login')
    expect(consumeOAuthFlow('attacker-controlled')).toBeNull()
    expect(peekOAuthFlow()).toBeNull()

    beginOAuthFlow('login')
    expect(consumeOAuthFlow(null)).toBeNull()
    expect(peekOAuthFlow()).toBeNull()
  })

  it('drops an expired flow', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-23T00:00:00Z'))
    const state = beginOAuthFlow('login')
    vi.setSystemTime(new Date('2026-10-23T00:11:00Z'))
    expect(peekOAuthFlow()).toBeNull()
    expect(consumeOAuthFlow(state)).toBeNull()
  })

  it('ignores corrupted storage entries', () => {
    sessionStorage.setItem('oauth_flow', '{not json')
    expect(peekOAuthFlow()).toBeNull()
    sessionStorage.setItem('oauth_flow', JSON.stringify({ state: 'x', action: 'evil', createdAt: 1 }))
    expect(peekOAuthFlow()).toBeNull()
    clearOAuthFlow()
    expect(sessionStorage.getItem('oauth_flow')).toBeNull()
  })
})
