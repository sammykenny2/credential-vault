/**
 * Content-Security-Policy served by nginx (frontend/security-headers.conf).
 *
 * The Vite dev server sends no CSP, so a policy that breaks the app only
 * shows up in the Docker build. These checks pin the directives the app
 * depends on.
 */

import { describe, it, expect } from 'vitest'
import conf from '../../security-headers.conf?raw'

function cspDirective(name: string): string[] {
  const policy = conf.match(/add_header Content-Security-Policy "([^"]+)"/)?.[1]
  expect(policy, 'Content-Security-Policy header not found').toBeDefined()
  const directive = policy!
    .split(';')
    .map((part: string) => part.trim().split(/\s+/))
    .find(([directiveName]: string[]) => directiveName === name)
  expect(directive, `${name} directive not found`).toBeDefined()
  return directive!.slice(1)
}

describe('nginx Content-Security-Policy', () => {
  it('lets hash-wasm compile Argon2id without allowing JavaScript eval', () => {
    const scriptSrc = cspDirective('script-src')
    expect(scriptSrc).toContain("'wasm-unsafe-eval'")
    expect(scriptSrc).not.toContain("'unsafe-eval'")
    expect(scriptSrc).not.toContain("'unsafe-inline'")
  })

  it('only talks to this origin and the HIBP range API', () => {
    expect(cspDirective('connect-src')).toEqual(["'self'", 'https://api.pwnedpasswords.com'])
  })

  it('cannot be framed', () => {
    expect(cspDirective('frame-ancestors')).toEqual(["'none'"])
  })
})
