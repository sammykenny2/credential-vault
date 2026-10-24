/**
 * Content-Security-Policy served by nginx (frontend/security-headers.conf).
 *
 * The Vite dev server sends no CSP, so a policy that breaks the app only
 * shows up in the Docker build. These checks pin the directives the app
 * depends on.
 */

import { describe, it, expect } from 'vitest'
import conf from '../../security-headers.conf?raw'
import nginxConf from '../../nginx.conf?raw'
import serviceWorker from '../../public/sw.js?raw'

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

// A cached HTML document is replayed with its old headers, so a CSP change
// would not reach a browser that still holds the document (seen in Firefox
// after a deploy: the old CSP kept blocking WebAssembly).
describe('the HTML document and its CSP reach the browser fresh after a deploy', () => {
  it('nginx makes browsers revalidate the SPA document, with the security headers', () => {
    const spaLocation = nginxConf.match(/location \/ \{([^}]*)\}/)?.[1] ?? ''
    expect(spaLocation).toContain('add_header Cache-Control "no-cache" always;')
    expect(spaLocation).toContain('include /etc/nginx/snippets/security-headers.conf;')
  })

  it('the service worker neither precaches nor caches HTML documents', () => {
    const precache = serviceWorker.match(/PRECACHE_URLS = \[([^\]]*)\]/)?.[1] ?? ''
    expect(precache).not.toMatch(/'\/'|'\/index\.html'/)
    expect(serviceWorker).toContain('event.respondWith(networkOnlyDocument(request))')
    expect(serviceWorker).not.toContain("caches.match('/index.html')")
  })
})
