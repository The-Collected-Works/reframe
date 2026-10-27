import { untrack } from 'svelte'
import type { AssetEntry, Fingerprint } from '@shared/types'
import { api } from '../lib/bridge'
import { showToast } from '../ui'
import { library } from './library.svelte'
import { filesOf, moved, relinked } from './model/files'
import { project } from './project.svelte'

/** Hashes asked for already, by file as it was (path, size, mtime): each file is read once. */
const hashes = new Map<string, string | null>()
const at = (a: AssetEntry) => `${a.path}|${a.size}|${a.mtime}`

async function hashesOf(assets: AssetEntry[]): Promise<Map<string, string>> {
  const asking = assets.filter((a) => !hashes.has(at(a)))
  if (asking.length) {
    const got = await api.hashFiles(asking.map((a) => a.path)).catch(() => asking.map(() => null))
    asking.forEach((a, i) => hashes.set(at(a), got[i]))
  }
  const out = new Map<string, string>()
  for (const a of assets) {
    const h = hashes.get(at(a))
    if (h) out.set(a.name, h)
  }
  return out
}

/**
 * Looks after the files the project refers to: remembers what's in each (its fingerprint), and when
 * one goes and a file with the same contents turns up under another name, moves everything that
 * referred to it over (see model/files). Runs shortly after the folder or the project changes.
 */
async function check(): Promise<void> {
  const assets = library.assets
  const file = project.file
  if (!library.dir) return
  const here = new Map(assets.map((a) => [a.name, a]))
  const used = filesOf(file)
  const known = file.files ?? {}
  const missing = Object.fromEntries([...used].filter((n) => !here.has(n) && known[n]).map((n) => [n, known[n]]))
  // Only files the project doesn't know, the size of a missing one, can be one of them moved.
  const sizes = new Set(Object.values(missing).map((f) => f.size))
  const unknown = assets.filter((a) => !used.has(a.name) && sizes.has(a.size))
  const hashed = await hashesOf([...unknown, ...[...used].flatMap((n) => here.get(n) ?? [])])
  // Changed meanwhile: the check that change starts takes over.
  if (library.assets !== assets || project.file !== file) return
  const moves = moved(
    missing,
    unknown.flatMap((a) => (hashed.has(a.name) ? [{ name: a.name, size: a.size, hash: hashed.get(a.name)! }] : []))
  )
  project.relink(moves)
  // Each file it refers to as it is now, or (gone) as it last was.
  const files: Record<string, Fingerprint> = {}
  for (const n of filesOf(relinked(file, moves))) {
    const a = here.get(n)
    const fp = a && hashed.has(n) ? { size: a.size, mtime: a.mtime, hash: hashed.get(n)! } : known[n]
    if (fp) files[n] = fp
  }
  project.setFiles(files)
  const [first] = moves
  if (first)
    showToast(
      moves.size === 1 ? `Found “${first[0]}” as “${first[1]}” · its settings came along` : `Found ${moves.size} renamed files · their settings came along`
    )
}

/** Call while the app initialises. */
export function trackFiles(): void {
  let timer: ReturnType<typeof setTimeout> | undefined
  $effect(() => {
    void library.assets
    void project.file
    untrack(() => {
      clearTimeout(timer)
      timer = setTimeout(check, 300)
    })
  })
  $effect(() => () => clearTimeout(timer))
}
