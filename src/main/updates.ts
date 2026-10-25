import { app, net, shell } from 'electron'
import type { ReleaseNote } from '@shared/types'
import pkg from '../../package.json'

/** "owner/name" from package.json's `repository`. Without one, update checks are off. */
function releasesRepo(): string | null {
  const r = (pkg as { repository?: string | { url?: string } }).repository
  const url = typeof r === 'string' ? r : (r?.url ?? '')
  return /github(?:\.com[/:]|:)([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/.exec(url)?.[1] ?? null
}

/** True when version `a` is newer than `b` (major.minor.patch; suffixes ignored). */
function newer(a: string, b: string): boolean {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0)
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0)
  return false
}

let releaseUrl: string | null = null

/**
 * Asks GitHub for recent releases and returns every published one newer than this build (newest
 * first, with their notes for the changelog). Quietly returns null when offline, rate-limited,
 * up to date, or the repository is private (the API needs a token for those).
 */
export async function checkForUpdate(): Promise<{ version: string; notes: ReleaseNote[] } | null> {
  const repo = releasesRepo()
  if (!repo) return null
  try {
    const res = await net.fetch(`https://api.github.com/repos/${repo}/releases?per_page=20`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Reframe' }
    })
    if (!res.ok) return null
    type Release = { tag_name?: string; name?: string; body?: string; html_url?: string; published_at?: string; draft?: boolean; prerelease?: boolean }
    const releases = ((await res.json()) as Release[])
      .filter((r) => !r.draft && !r.prerelease)
      .map((r) => ({ ...r, version: String(r.tag_name ?? '').replace(/^v/, '') }))
      .filter((r) => r.version && newer(r.version, app.getVersion()))
      .sort((a, b) => (newer(a.version, b.version) ? -1 : newer(b.version, a.version) ? 1 : 0))
    if (!releases.length) return null
    const latest = releases[0]
    releaseUrl = latest.html_url ?? `https://github.com/${repo}/releases/latest`
    return {
      version: latest.version,
      notes: releases.map((r) => ({
        version: r.version,
        name: r.name ?? '',
        date: r.published_at ?? '',
        body: (r.body ?? '').slice(0, 20000)
      }))
    }
  } catch {
    return null
  }
}

/** Opens the release page found by the last check; the renderer never supplies the URL. */
export function openRelease(): void {
  if (releaseUrl?.startsWith('https://github.com/')) shell.openExternal(releaseUrl)
}
