/**
 * Which build is running.
 *
 * The interface's own version and commit are baked into the bundle at build
 * time; the server reports its own on /health. They differ when the browser
 * still runs an older bundle than the one deployed (or after a rollback).
 */

export const APP_VERSION: string = __APP_VERSION__
export const APP_REVISION: string = __APP_REVISION__

export interface BuildInfo {
  version: string
  revision: string
}

/** "v0.3.0 · 501cad8": the version, plus the short commit when it is one. */
export function formatBuild({ version, revision }: BuildInfo): string {
  const commit = revision.match(/^([0-9a-f]{7})[0-9a-f]{33}(-dirty)?$/)
  const shortRevision = commit ? commit[1] + (commit[2] ?? '') : revision
  return `v${version} · ${shortRevision}`
}

export function isSameBuild(a: BuildInfo, b: BuildInfo): boolean {
  return a.version === b.version && a.revision === b.revision
}

/** The server's build, from /health. */
export async function fetchServerBuild(): Promise<BuildInfo> {
  const response = await fetch('/health', { cache: 'no-store' })
  if (!response.ok) throw new Error(`/health answered ${response.status}`)
  const body = (await response.json()) as Partial<BuildInfo>
  return { version: String(body.version ?? 'unknown'), revision: String(body.revision ?? 'unknown') }
}
