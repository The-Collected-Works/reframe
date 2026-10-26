import { resolveSettings } from '@shared/layout'
import type { Artboard, SkippedFolder } from '@shared/types'
import type { ViewPrefs } from '../prefs'
import type { Entry } from './items'
import { hasOverrides } from './project'

/**
 * The library: every item as the grid shows it, a tree of folders filtered and sorted by the view
 * options, with the layouts in a section of their own above. Asset names are paths relative to the
 * open folder, "/"-separated; a variant sits in its file's folder, right after it.
 */

/** The layouts' section, folded and remembered like a folder. Not a path: no folder is called that. */
export const LAYOUTS = '~layouts'

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
  assets: Entry[]
  children: FolderNode[]
  count: number
  collapsed: boolean
  excluded?: SkippedFolder
}

/** `sectioned`: folders get headers (to fold them by); without, it's one plain run of thumbnails. */
export type Layout = { tree: FolderNode[]; visible: Entry[]; sectioned: boolean }

/**
 * What the grid shows, from the items and the view options. The layouts come first, in a section of
 * their own. Grouped, then a tree of folders: the top level's own files first (if any), then each
 * top-level folder with its subfolders inside it. Not grouped, one node holding everything else.
 * Also the flat list of visible assets in on-screen
 * order (a folder's files, then its subfolders; nothing inside a collapsed folder), which the
 * filmstrip, arrow keys, Select All, shift-click ranges and the export dialog's "Visible" scope
 * all follow. `board` is only given when the filter looks at edits.
 */
export function layout(all: Entry[], prefs: ViewPrefs, collapsed: string[], skipped: SkippedFolder[], board: Artboard | null): Layout {
  const { filter, sort, group } = prefs
  const pass = (a: Entry) =>
    filter === 'images'
      ? a.kind === 'image'
      : filter === 'videos'
        ? a.kind === 'video'
        : filter === 'adjusted'
          ? !!board && hasOverrides(board, a.name)
          : filter === 'excluded'
            ? !!board && resolveSettings(board, a.name).skip
            : true
  // A variant sorts as its file does (it has the file's kind and date), then after it, by name.
  const home = (a: Entry) => a.source ?? a.name
  const byName = (a: Entry, b: Entry) => natural(baseName(home(a)), baseName(home(b))) || natural(folderOf(home(a)), folderOf(home(b)))
  const files =
    sort === 'date'
      ? (a: Entry, b: Entry) => b.mtime - a.mtime || byName(a, b)
      : sort === 'type'
        ? (a: Entry, b: Entry) => natural(a.kind, b.kind) || byName(a, b)
        : byName
  const cmp = (a: Entry, b: Entry) => files(a, b) || +!!a.source - +!!b.source || natural(a.label, b.label)
  const layouts = all.filter((a) => a.kind === 'layout' && pass(a)).sort((a, b) => natural(a.label, b.label))
  const assets = all.filter((a) => a.kind !== 'layout')
  const layoutNode: FolderNode[] = layouts.length
    ? [{ folder: LAYOUTS, name: 'Layouts', assets: layouts, children: [], count: layouts.length, collapsed: group && collapsed.includes(LAYOUTS) }]
    : []
  const node = (folder: string): FolderNode => ({
    folder,
    name: folder.slice(folder.lastIndexOf('/') + 1),
    assets: [],
    children: [],
    count: 0,
    collapsed: collapsed.includes(folder)
  })
  if (!group) {
    const flat = { ...node(''), collapsed: false, assets: assets.filter(pass).sort(cmp) }
    flat.count = flat.assets.length
    return { tree: [...layoutNode, ...(flat.count ? [flat] : [])], visible: [...layouts, ...flat.assets], sectioned: false }
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
    const folder = folderOf(home(a))
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
  const tree = [...layoutNode, ...(top.assets.length ? [top] : []), ...roots]
  // A flat folder needs no headers; as soon as there's anything else (subfolders, excluded ones,
  // layouts), every section gets one. Without headers nothing can be folded: a fold left from when
  // there were (the layouts since deleted, say) would otherwise hide everything, out of reach.
  const sectioned = tree.length > 1 || (tree.length === 1 && tree[0].folder !== '')
  if (!sectioned) tree.forEach((n) => (n.collapsed = false))

  const visible: Entry[] = []
  const walk = (n: FolderNode) => {
    if (n.collapsed || n.excluded) return
    visible.push(...n.assets)
    n.children.forEach(walk)
  }
  tree.forEach(walk)
  return { tree, visible, sectioned }
}
