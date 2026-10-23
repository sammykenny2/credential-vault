/**
 * OAuth `state` handling for the Google sign-in and account-link flows.
 *
 * Before redirecting to Google the tab generates a random state and remembers
 * it together with the intended action in sessionStorage (same tab, survives
 * the redirect, gone when the tab closes). When Google redirects back, the
 * state in the URL must match or the callback is ignored. This stops a third
 * party from completing a sign-in in the victim's browser (login CSRF).
 */

export type OAuthAction = 'login' | 'link'

export interface PendingOAuthFlow {
  state: string
  action: OAuthAction
  createdAt: number
}

const STORAGE_KEY = 'oauth_flow'
/** A flow older than this is treated as abandoned. */
const MAX_AGE_MS = 10 * 60 * 1000

function base64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function randomState(): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(24)))
}

function readFlow(): PendingOAuthFlow | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<PendingOAuthFlow>
    if (
      typeof parsed.state !== 'string' ||
      (parsed.action !== 'login' && parsed.action !== 'link') ||
      typeof parsed.createdAt !== 'number'
    ) {
      return null
    }
    return parsed as PendingOAuthFlow
  } catch {
    return null
  }
}

/** Start a flow: remember a fresh state for this tab and return it. */
export function beginOAuthFlow(action: OAuthAction): string {
  const flow: PendingOAuthFlow = { state: randomState(), action, createdAt: Date.now() }
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(flow))
  } catch {
    // Storage unavailable: the callback will fail the state check, which is
    // the safe outcome.
  }
  return flow.state
}

/** Look at the pending flow without consuming it. Expired flows are dropped. */
export function peekOAuthFlow(): PendingOAuthFlow | null {
  const flow = readFlow()
  if (!flow) return null
  if (Date.now() - flow.createdAt > MAX_AGE_MS) {
    clearOAuthFlow()
    return null
  }
  return flow
}

/**
 * Finish a flow: the pending entry is always removed, and the flow is returned
 * only when `stateFromUrl` matches the stored state exactly.
 */
export function consumeOAuthFlow(stateFromUrl: string | null): PendingOAuthFlow | null {
  const flow = peekOAuthFlow()
  clearOAuthFlow()
  if (!flow || !stateFromUrl || stateFromUrl !== flow.state) return null
  return flow
}

export function clearOAuthFlow(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    // Nothing to clear.
  }
}
