import { resolveSettings } from '@shared/layout'
import type { Artboard, AssetEntry, SkippedFolder } from '@shared/types'
import type { ViewPrefs } from './prefs'
import { hasOverrides } from './project'

/**
 * The library: the scanned assets as the grid shows them, a tree of folders filtered and sorted
 * by the view options. Asset names are paths relative to the open folder, "/"-separated.
 */

/** An asset's file name, without the folders it's in ("Shoot A/clip.mp4" → "clip.mp4"). */
export const baseName = (name: string): string => name.slice(name.lastIndexOf('/') + 1)

/** The folder an asset is in, relative to the open one ("" for the top level). */
export const folderOf = (name: string): string => name.slice(0, Math.max(0, name.lastIndexOf('/')))

// One collator for every comparison (localeCompare with options builds one each call: ~15× slower).
const natural = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }).compare

/**
 * A folder in the grid: its own assets (filtered and sorted) and its subfolders, as the tree it is
 * on disk. `count` is everything inside it. Excluded folders are leaves, marked with why.
 */
export interface FolderNode {
  /** Relative path, "/"-separated; "" is the top level's own files. */
  folder: string
  name: string
  assets: AssetEntry[]
  children: FolderNode[]
  count: number
  collapsed: boolean
  excluded?: SkippedFolder
}

export type Layout = { tree: FolderNode[]; visible: AssetEntry[] }

/**
 * What the grid shows, from the assets and the view options. Grouped, a tree of folders: the top
 * level's own files first (if any), then each top-level folder with its subfolders inside it.
 * Not grouped, one node holding everything. Also the flat list of visible assets in on-screen
 * order (a folder's files, then its subfolders; nothing inside a collapsed folder), which the
 * filmstrip, arrow keys, Select All, shift-click ranges and the export dialog's "Visible" scope
 * all follow. `board` is only given when the filter looks at edits.
 */
export function layout(assets: AssetEntry[], prefs: ViewPrefs, collapsed: string[], skipped: SkippedFolder[], board: Artboard | null): Layout {
  const { filter, sort, group } = prefs
  const pass = (a: AssetEntry) =>
    filter === 'images'
      ? a.kind === 'image'
      : filter === 'videos'
        ? a.kind === 'video'
        : filter === 'adjusted'
          ? !!board && hasOverrides(board, a.name)
          : filter === 'excluded'
            ? !!board && resolveSettings(board, a.name).skip
            : true
  const byName = (a: AssetEntry, b: AssetEntry) => natural(baseName(a.name), baseName(b.name)) || natural(folderOf(a.name), folderOf(b.name))
  const cmp =
    sort === 'date'
      ? (a: AssetEntry, b: AssetEntry) => b.mtime - a.mtime || byName(a, b)
      : sort === 'type'
        ? (a: AssetEntry, b: AssetEntry) => natural(a.kind, b.kind) || byName(a, b)
        : byName
  const node = (folder: string): FolderNode => ({
    folder,
    name: folder.slice(folder.lastIndexOf('/') + 1),
    assets: [],
    children: [],
    count: 0,
    collapsed: collapsed.includes(folder)
  })
  if (!group) {
    const all = { ...node(''), collapsed: false, assets: assets.filter(pass).sort(cmp) }
    all.count = all.assets.length
    return { tree: [all], visible: all.assets }
  }

  // Build the tree: every folder with something to show, and the folders leading to it.
  const nodes = new Map<string, FolderNode>()
  const top = node('')
  const ensure = (folder: string): FolderNode => {
    let n = nodes.get(folder)
    if (!n) {
      n = node(folder)
      nodes.set(folder, n)
      const parent = folderOf(folder)
      if (parent) ensure(parent).children.push(n)
    }
    return n
  }
  for (const a of assets) {
    if (!pass(a)) continue
    const folder = folderOf(a.name)
    ;(folder ? ensure(folder) : top).assets.push(a)
  }
  for (const f of skipped) ensure(f.path).excluded = f
  const roots = [...nodes.values()].filter((n) => !n.folder.includes('/'))
  const finish = (n: FolderNode): number => {
    n.assets.sort(cmp)
    n.children.sort((a, b) => natural(a.name, b.name))
    n.count = n.assets.length + n.children.reduce((sum, c) => sum + finish(c), 0)
    return n.count
  }
  roots.sort((a, b) => natural(a.name, b.name)).forEach(finish)
  top.assets.sort(cmp)
  top.count = top.assets.length
  const tree = [...(top.assets.length ? [top] : []), ...roots]

  const visible: AssetEntry[] = []
  const walk = (n: FolderNode) => {
    if (n.collapsed || n.excluded) return
    visible.push(...n.assets)
    n.children.forEach(walk)
  }
  tree.forEach(walk)
  return { tree, visible }
}
