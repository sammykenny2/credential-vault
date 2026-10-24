/**
 * The sidebar shows which build the browser runs, and offers a reload when
 * the server reports a different one (a stale bundle, or a new deploy).
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import VersionInfo from '@/components/VersionInfo'
import { APP_REVISION, APP_VERSION, formatBuild } from '@/lib/version'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement | undefined
let root: Root | undefined

function serverReports(body: object) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 200 })))
}

async function render() {
  const div = document.createElement('div')
  document.body.appendChild(div)
  const reactRoot = createRoot(div)
  container = div
  root = reactRoot
  await act(async () =>
    reactRoot.render(
      <QueryClientProvider client={new QueryClient()}>
        <VersionInfo />
      </QueryClientProvider>
    )
  )
  // Let the /health query settle and re-render
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  return div
}

describe('VersionInfo', () => {
  afterEach(() => {
    if (root) act(() => root!.unmount())
    container?.remove()
    root = undefined
    container = undefined
    vi.unstubAllGlobals()
  })

  it('formats the version with the short commit', () => {
    const sha = '501cad873d74178f47723b47a92cc98046c58322'
    expect(formatBuild({ version: '0.3.0', revision: sha })).toBe('v0.3.0 · 501cad8')
    expect(formatBuild({ version: '0.3.0', revision: `${sha}-dirty` })).toBe('v0.3.0 · 501cad8-dirty')
    expect(formatBuild({ version: '0.3.0', revision: 'dev' })).toBe('v0.3.0 · dev')
  })

  it('shows the interface build and no hint when the server runs the same', async () => {
    serverReports({ status: 'healthy', version: APP_VERSION, revision: APP_REVISION })
    const view = await render()

    expect(view.textContent).toContain(formatBuild({ version: APP_VERSION, revision: APP_REVISION }))
    expect(view.querySelector('button')).toBeNull()
    expect(fetch).toHaveBeenCalledWith('/health', { cache: 'no-store' })
  })

  it('offers a reload when the server runs another build', async () => {
    serverReports({ status: 'healthy', version: '9.9.9', revision: 'fedcba9876543210fedcba9876543210fedcba98' })
    const view = await render()

    expect(view.querySelector('button')?.textContent).toContain('Server runs v9.9.9 · fedcba9')
  })

  it('stays quiet when /health cannot be read', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')))
    const view = await render()

    expect(view.textContent).toContain(`v${APP_VERSION}`)
    expect(view.querySelector('button')).toBeNull()
  })
})
