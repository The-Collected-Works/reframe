import { mapNode, slotsOf } from '@shared/composition/bento'
import type { Fingerprint, ProjectFile, VirtualItem } from '@shared/types'
import { isVirtual, itemsOf } from './items'
import { folderOf } from './tree'

/**
 * The files a project refers to, by name (their paths from the open folder): in framings and trims,
 * as variants' sources, in composition cells. One rule keeps them: a file that's gone, when a file
 * with the same contents turns up under another name, was renamed or moved, and every reference
 * follows it. Plain data in, plain data out.
 */

/** Every file the project refers to, whether or not it's there. */
export function filesOf(file: ProjectFile): Set<string> {
  const names = new Set<string>()
  const add = (n: string | null | undefined) => {
    if (n && !isVirtual(n)) names.add(n)
  }
  for (const b of file.artboards) Object.keys(b.overrides).forEach(add)
  Object.keys(file.clips).forEach(add)
  for (const i of Object.values(itemsOf(file))) {
    if (i.kind === 'variant') add(i.source)
    else slotsOf(i.root).forEach((s) => add(s.item))
  }
  return names
}

/** A file that's there, and what's in it. */
export interface Found {
  name: string
  size: number
  hash: string
}

/**
 * Which missing files turned up under other names (from → to): each whose fingerprint matches one of
 * `found` (files the project doesn't refer to yet), or, of several, the one in its folder. Anything
 * still ambiguous is left alone.
 */
export function moved(missing: Record<string, Fingerprint>, found: Found[]): Map<string, string> {
  const moves = new Map<string, string>()
  const taken = new Set<string>()
  for (const [name, fp] of Object.entries(missing)) {
    let same = found.filter((f) => f.size === fp.size && f.hash === fp.hash && !taken.has(f.name))
    if (same.length > 1) same = same.filter((f) => folderOf(f.name) === folderOf(name))
    if (same.length !== 1) continue
    moves.set(name, same[0].name)
    taken.add(same[0].name)
  }
  return moves
}

/** `file` with every reference to a file in `moves` changed to its new name. */
export function relinked(file: ProjectFile, moves: Map<string, string>): ProjectFile {
  if (!moves.size) return file
  const to = (n: string) => moves.get(n) ?? n
  const rekey = <T>(r: Record<string, T>) => Object.fromEntries(Object.entries(r).map(([k, v]) => [to(k), v]))
  const item = (i: VirtualItem): VirtualItem => {
    if (i.kind === 'variant') return moves.has(i.source) ? { ...i, source: to(i.source) } : i
    let root = i.root
    for (const s of slotsOf(root)) if (s.item && moves.has(s.item)) root = mapNode(root, s.id, (n) => ({ ...n, item: to(s.item!) }))
    return root === i.root ? i : { ...i, root }
  }
  return {
    ...file,
    artboards: file.artboards.map((b) => ({ ...b, overrides: rekey(b.overrides) })),
    clips: rekey(file.clips),
    items: Object.fromEntries(Object.entries(itemsOf(file)).map(([k, i]) => [k, item(i)])),
    ...(file.files ? { files: rekey(file.files) } : {})
  }
}

/** Whether two sets of fingerprints say the same. */
export function sameFiles(a: Record<string, Fingerprint>, b: Record<string, Fingerprint>): boolean {
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every((k) => b[k] && a[k].size === b[k].size && a[k].mtime === b[k].mtime && a[k].hash === b[k].hash)
}
