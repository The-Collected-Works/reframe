import { app, net, shell } from 'electron'
import pkg from '../../package.json'

/** "owner/name" from package.json's `repository`. Without one, update checks are off. */
function releasesRepo(): string | null {
  const r = (pkg as { repository?: string | { url?: string } }).repository
  const url = typeof r === 'string' ? r : r?.url ?? ''
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
 * Asks GitHub for the latest published release. Quietly returns null when offline, rate-limited,
 * or the repository is private (the API needs a token for those).
 */
export async function checkForUpdate(): Promise<{ version: string } | null> {
  const repo = releasesRepo()
  if (!repo) return null
  try {
    const res = await net.fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Reframe' }
    })
    if (!res.ok) return null
    const { tag_name, html_url } = (await res.json()) as { tag_name?: string; html_url?: string }
    const version = String(tag_name ?? '').replace(/^v/, '')
    if (!version || !newer(version, app.getVersion())) return null
    releaseUrl = html_url ?? `https://github.com/${repo}/releases/latest`
    return { version }
  } catch {
    return null
  }
}

/** Opens the release page found by the last check; the renderer never supplies the URL. */
export function openRelease(): void {
  if (releaseUrl?.startsWith('https://github.com/')) shell.openExternal(releaseUrl)
}
