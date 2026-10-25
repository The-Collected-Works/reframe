import { useMemo } from 'react'
import { create } from 'zustand'
import { DEFAULT_SETTINGS, resolveSettings } from '@shared/layout'
import type { IconName } from './components/ui'
import type { Artboard, AssetEntry, Clip, ColorMeta, CropSettings, ExportPrefs, FolderScan, ProjectFile, SettingKey, SkippedFolder } from '@shared/types'

export interface Asset extends AssetEntry {
  w: number
  h: number
  duration: number
  color?: ColorMeta
  audio?: boolean
  /** Video frame rate; 0 if unknown. */
  fps?: number
  thumb: ImageBitmap | null
  error: boolean
}

export type View = 'grid' | 'loupe'

export interface AppMenuItem {
  id?: string
  label?: string
  icon?: IconName
  shortcut?: string
  /** Present makes it a toggle, shown with a trailing check. */
  checked?: boolean
  enabled?: boolean
  /** Destructive: shown in red. */
  danger?: boolean
  separator?: boolean
}

export const PRESETS: { name: string; width: number; height: number }[] = [
  { name: 'Square', width: 1080, height: 1080 },
  { name: 'Portrait', width: 1080, height: 1350 },
  { name: 'Story', width: 1080, height: 1920 },
  { name: 'Landscape', width: 1920, height: 1080 },
  { name: 'Wide', width: 2560, height: 1080 },
  { name: 'Classic', width: 1440, height: 1080 }
]

const uid = () => Math.random().toString(36).slice(2, 10)

export function newBoard(name: string, width: number, height: number, defaults: CropSettings = DEFAULT_SETTINGS): Artboard {
  return { id: uid(), name, width, height, defaults: { ...defaults }, overrides: {} }
}

function emptyProject(): ProjectFile {
  return {
    version: 1,
    artboards: [newBoard('Square', 1080, 1080)],
    clips: {},
    export: { dir: null, imageFormat: 'png', imageQuality: 0.92, videoCrf: 18 }
  }
}

const KNOWN = new Set(Object.keys(DEFAULT_SETTINGS))
/** Drops settings this version doesn't know (e.g. ones removed since the file was saved). */
const known = (o: object | undefined): Partial<CropSettings> =>
  Object.fromEntries(Object.entries(o ?? {}).filter(([k]) => KNOWN.has(k))) as Partial<CropSettings>

function normalizeProject(p: ProjectFile | null): ProjectFile {
  const base = emptyProject()
  if (!p || !p.artboards?.length) return base
  return {
    version: 1,
    artboards: p.artboards.map((b) => ({
      ...b,
      defaults: { ...DEFAULT_SETTINGS, ...known(b.defaults) },
      overrides: Object.fromEntries(
        Object.entries(b.overrides ?? {})
          .map(([n, o]) => [n, known(o)] as const)
          .filter(([, o]) => Object.keys(o).length)
      )
    })),
    clips: p.clips ?? {},
    export: { ...base.export, ...p.export }
  }
}

interface State {
  dir: string | null
  assets: Asset[]
  /** Subfolders the scan left out (exports, or excluded by the user). */
  skipped: SkippedFolder[]
  /** The scan stopped at its file limit. */
  truncated: boolean
  project: ProjectFile
  boardId: string
  selection: string[]
  focus: string | null
  view: View
  cellSize: number
  /** How the grid shows assets (filter, sort, grouping, captions). Per user, remembered. */
  viewPrefs: ViewPrefs
  /** Folders folded away in the grid (with everything inside). Remembered per project folder. */
  collapsed: string[]
  clipboard: Partial<CropSettings> | null
  past: ProjectFile[]
  future: ProjectFile[]
  exportOpen: boolean
  boardEditor: string | null
  /** Eyedropper armed: the next click on media samples the background colour. */
  picking: boolean
  /** Brief confirmation shown over the content (copy, paste, undo). `n` restarts it. */
  hud: { text: string; n: number } | null
  /** The open context menu (see menus.ts / ContextMenu.tsx). */
  contextMenu: { x: number; y: number; items: AppMenuItem[] } | null
  /** Preview playback volume, shared by every video and remembered between sessions. */
  volume: number
  lastVolume: number
}

interface Actions {
  load(scan: FolderScan): void
  rescan(scan: FolderScan): void
  patchAsset(name: string, patch: Partial<Asset>): void
  setView(view: View): void
  setCellSize(n: number): void
  setViewPrefs(patch: Partial<ViewPrefs>): void
  /** Default filter, sort, grouping and captions, and every folder open. */
  resetView(): void
  toggleCollapsed(folder: string): void
  /** Folds away every folder, or none. */
  setAllCollapsed(collapse: boolean): void
  select(name: string, mode?: 'replace' | 'toggle' | 'range'): void
  selectAll(): void
  clearSelection(): void
  step(delta: number): void
  /** Edits defaults when nothing is selected, otherwise overrides on the selection. */
  edit(patch: Partial<CropSettings>): void
  editAsset(name: string, patch: Partial<CropSettings>): void
  /** Like edit(), but computes the patch from each target's current settings. */
  editEach(fn: (s: CropSettings) => Partial<CropSettings>): void
  setSelection(names: string[]): void
  /** Makes the focused asset's values for `keys` the artboard defaults; the selection then follows them. */
  makeDefault(keys: SettingKey[]): void
  /** Removes overrides so the keys follow the defaults again. Defaults to the selection. */
  resetKeys(keys: SettingKey[], names?: string[]): void
  copy(): void
  paste(): void
  setClip(name: string, clip: Clip | null): void
  setBoard(id: string): void
  addBoard(name: string, width: number, height: number): void
  updateBoard(id: string, patch: Partial<Pick<Artboard, 'name' | 'width' | 'height'>>): void
  duplicateBoard(id: string): void
  removeBoard(id: string): void
  setExportPrefs(patch: Partial<ExportPrefs>): void
  setExportOpen(open: boolean): void
  setBoardEditor(id: string | null): void
  setPicking(picking: boolean): void
  showHud(text: string): void
  setVolume(volume: number): void
  undo(): void
  redo(): void
}

export type Store = State & Actions

let lastCommit = 0

export type SortKey = 'name' | 'date' | 'type'
export type FilterKey = 'all' | 'images' | 'videos' | 'adjusted' | 'excluded'
export interface ViewPrefs {
  filter: FilterKey
  sort: SortKey
  /** Sections per folder; off, one continuous grid. */
  group: boolean
  /** File names under thumbnails. */
  names: boolean
}
export const VIEW_DEFAULTS: ViewPrefs = { filter: 'all', sort: 'name', group: true, names: true }

function read<T>(key: string, fallback: T): T {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? 'null')
    return v ?? fallback
  } catch {
    return fallback
  }
}

function store(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Not persisted; fine.
  }
}

const storedView = (): ViewPrefs => ({ ...VIEW_DEFAULTS, ...read<Partial<ViewPrefs>>('reframe.view', {}) })
const storedCollapsed = (dir: string): string[] => {
  const v = read<unknown>('reframe.collapsed:' + dir, [])
  return Array.isArray(v) ? v.filter((f): f is string => typeof f === 'string') : []
}

function storedVolume(): number {
  try {
    const v = parseFloat(localStorage.getItem('reframe.volume') ?? '')
    return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.8
  } catch {
    return 0.8
  }
}

export const useStore = create<Store>()((set, get) => {
  /** Applies a project change, coalescing rapid edits (slider drags) into one undo step. */
  const commit = (next: ProjectFile) => {
    const { project, past } = get()
    const now = performance.now()
    const push = now - lastCommit > 600
    lastCommit = now
    set({ project: next, past: push ? [...past.slice(-99), project] : past, future: [] })
  }

  const mapBoard = (fn: (b: Artboard) => Artboard, id = get().boardId) => {
    const { project } = get()
    commit({ ...project, artboards: project.artboards.map((b) => (b.id === id ? fn(b) : b)) })
  }

  // An override is set by editing an asset and removed only by an explicit reset, even if its
  // value happens to equal the default, so it never silently starts following defaults.
  const withOverrides = (b: Artboard, names: string[], patch: Partial<CropSettings>): Artboard => {
    const overrides = { ...b.overrides }
    for (const name of names) {
      const o = { ...overrides[name], ...patch }
      if (Object.keys(o).length) overrides[name] = o
      else delete overrides[name]
    }
    return { ...b, overrides }
  }

  const withoutOverrides = (b: Artboard, names: string[], keys: SettingKey[]): Artboard => {
    const overrides = { ...b.overrides }
    for (const name of names) {
      if (!overrides[name]) continue
      const o = { ...overrides[name] }
      for (const k of keys) delete o[k]
      if (Object.keys(o).length) overrides[name] = o
      else delete overrides[name]
    }
    return { ...b, overrides }
  }

  const toAsset = (e: AssetEntry, prev?: Asset): Asset =>
    prev && prev.mtime === e.mtime && prev.size === e.size
      ? { ...prev, ...e }
      : { ...e, w: 0, h: 0, duration: 0, thumb: null, error: false }

  return {
    dir: null,
    skipped: [],
    truncated: false,
    assets: [],
    project: emptyProject(),
    boardId: '',
    selection: [],
    focus: null,
    view: 'grid',
    cellSize: 220,
    viewPrefs: storedView(),
    collapsed: [],
    clipboard: null,
    past: [],
    future: [],
    exportOpen: false,
    boardEditor: null,
    picking: false,
    hud: null,
    contextMenu: null,
    volume: storedVolume(),
    lastVolume: storedVolume() || 0.8,

    load(scan) {
      const project = normalizeProject(scan.project)
      set({
        dir: scan.dir,
        assets: scan.assets.map((e) => toAsset(e)),
        skipped: scan.skipped,
        truncated: scan.truncated,
        collapsed: storedCollapsed(scan.dir),
        project,
        boardId: project.artboards[0].id,
        selection: [],
        focus: null,
        view: 'grid',
        past: [],
        future: []
      })
    },

    rescan(scan) {
      const prev = new Map(get().assets.map((a) => [a.name, a]))
      const assets = scan.assets.map((e) => toAsset(e, prev.get(e.name)))
      const names = new Set(assets.map((a) => a.name))
      const selection = get().selection.filter((n) => names.has(n))
      const focus = get().focus && names.has(get().focus!) ? get().focus : selection[0] ?? null
      set({ assets, selection, focus, view: focus ? get().view : 'grid', skipped: scan.skipped, truncated: scan.truncated })
    },

    patchAsset(name, patch) {
      set({ assets: get().assets.map((a) => (a.name === name ? { ...a, ...patch } : a)) })
    },

    setView(view) {
      const { focus, selection } = get()
      if (view === 'loupe' && !focus) {
        const first = selection[0] ?? layout(get()).visible[0]?.name
        if (!first) return
        set({ focus: first, selection: selection.length ? selection : [first] })
      }
      set({ view })
    },

    setCellSize: (cellSize) => set({ cellSize }),

    setViewPrefs(patch) {
      const viewPrefs = { ...get().viewPrefs, ...patch }
      set({ viewPrefs })
      store('reframe.view', viewPrefs)
      keepVisibleSelection()
    },

    resetView() {
      const { dir } = get()
      set({ viewPrefs: { ...VIEW_DEFAULTS }, collapsed: [] })
      store('reframe.view', VIEW_DEFAULTS)
      if (dir) store('reframe.collapsed:' + dir, [])
      keepVisibleSelection()
    },

    toggleCollapsed(folder) {
      const { collapsed, dir } = get()
      const next = collapsed.includes(folder) ? collapsed.filter((f) => f !== folder) : [...collapsed, folder]
      set({ collapsed: next })
      if (dir) store('reframe.collapsed:' + dir, next)
      keepVisibleSelection()
    },

    setAllCollapsed(collapse) {
      const { assets, dir } = get()
      // Every folder, including ones that only hold other folders.
      const folders = new Set<string>()
      for (const a of assets) for (let f = folderOf(a.name); f; f = folderOf(f)) folders.add(f)
      const next = collapse ? [...folders] : []
      set({ collapsed: next })
      if (dir) store('reframe.collapsed:' + dir, next)
      keepVisibleSelection()
    },

    select(name, mode = 'replace') {
      const { selection, focus } = get()
      if (mode === 'toggle') {
        const has = selection.includes(name)
        const next = has ? selection.filter((n) => n !== name) : [...selection, name]
        set({ selection: next, focus: has ? next[next.length - 1] ?? null : name })
      } else if (mode === 'range' && focus) {
        // A shift-click range covers what's on screen, in on-screen order.
        const names = layout(get()).visible.map((a) => a.name)
        const [a, b] = [names.indexOf(focus), names.indexOf(name)].sort((x, y) => x - y)
        set({ selection: names.slice(a, b + 1) })
      } else {
        set({ selection: [name], focus: name })
      }
    },

    setSelection(names) {
      const { focus } = get()
      set({ selection: names, focus: focus && names.includes(focus) ? focus : names[0] ?? null })
    },

    selectAll: () => set({ selection: layout(get()).visible.map((a) => a.name) }),
    // In single view the focused asset stays on screen; only the inspector switches to defaults.
    clearSelection: () => set({ selection: [], focus: get().view === 'loupe' ? get().focus : null }),

    // Through what's visible, in on-screen order (filtered, sorted, collapsed folders skipped).
    step(delta) {
      const { focus } = get()
      const assets = layout(get()).visible
      if (!assets.length) return
      const i = focus ? assets.findIndex((a) => a.name === focus) : -1
      const next = assets[Math.max(0, Math.min(assets.length - 1, i + delta))].name
      set({ selection: [next], focus: next })
    },

    edit(patch) {
      const { selection } = get()
      if (!selection.length) {
        mapBoard((b) => ({ ...b, defaults: { ...b.defaults, ...patch } }))
      } else {
        mapBoard((b) => withOverrides(b, selection, patch))
      }
    },

    editAsset(name, patch) {
      mapBoard((b) => withOverrides(b, [name], patch))
    },

    editEach(fn) {
      const { selection, project, boardId } = get()
      const board = project.artboards.find((b) => b.id === boardId)
      if (!board) return
      if (!selection.length) return get().edit(fn(board.defaults))
      mapBoard((b) => selection.reduce((acc, n) => withOverrides(acc, [n], fn(resolveSettings(acc, n))), b))
    },

    makeDefault(keys) {
      const { selection, focus, project, boardId } = get()
      const board = project.artboards.find((b) => b.id === boardId)
      if (!board || !selection.length) return
      const source = resolveSettings(board, focus && selection.includes(focus) ? focus : selection[0])
      const values = Object.fromEntries(keys.map((k) => [k, source[k]])) as Partial<CropSettings>
      mapBoard((b) => withoutOverrides({ ...b, defaults: { ...b.defaults, ...values } }, selection, keys))
      get().showHud(`Now the default for ${board.name}`)
    },

    resetKeys(keys, names = get().selection) {
      mapBoard((b) => withoutOverrides(b, names, keys))
    },

    // Copies the asset's overrides (not its resolved values), so pasted assets keep following
    // the defaults for everything the source does.
    copy() {
      const { focus, project, boardId } = get()
      const board = project.artboards.find((b) => b.id === boardId)
      if (!board || !focus) return
      const { skip: _skip, ...overrides } = board.overrides[focus] ?? {}
      set({ clipboard: overrides })
      const n = Object.keys(overrides).length
      get().showHud(n ? `Copied ${n} setting${n === 1 ? '' : 's'}` : 'Copied defaults')
    },

    paste() {
      const { clipboard, selection } = get()
      if (!clipboard || !selection.length) return
      const keys = (Object.keys(DEFAULT_SETTINGS) as SettingKey[]).filter((k) => k !== 'skip')
      mapBoard((b) => withOverrides(withoutOverrides(b, selection, keys), selection, clipboard))
      get().showHud(selection.length > 1 ? `Pasted to ${selection.length} items` : 'Pasted')
    },

    setClip(name, clip) {
      const { project } = get()
      const clips = { ...project.clips }
      if (clip && (clip.start > 0 || clip.end != null)) clips[name] = clip
      else delete clips[name]
      commit({ ...project, clips })
    },

    setBoard: (boardId) => set({ boardId }),

    addBoard(name, width, height) {
      const { project, boardId } = get()
      const current = project.artboards.find((b) => b.id === boardId)
      const board = newBoard(name, width, height, current?.defaults)
      commit({ ...project, artboards: [...project.artboards, board] })
      set({ boardId: board.id })
    },

    updateBoard(id, patch) {
      mapBoard((b) => ({ ...b, ...patch }), id)
    },

    duplicateBoard(id) {
      const { project } = get()
      const src = project.artboards.find((b) => b.id === id)
      if (!src) return
      const copy: Artboard = { ...structuredClone(src), id: uid(), name: `${src.name} copy` }
      const i = project.artboards.indexOf(src)
      const artboards = [...project.artboards]
      artboards.splice(i + 1, 0, copy)
      commit({ ...project, artboards })
      set({ boardId: copy.id, boardEditor: null })
    },

    removeBoard(id) {
      const { project, boardId } = get()
      if (project.artboards.length < 2) return
      const artboards = project.artboards.filter((b) => b.id !== id)
      commit({ ...project, artboards })
      if (boardId === id) set({ boardId: artboards[0].id })
      set({ boardEditor: null })
    },

    setExportPrefs(patch) {
      const { project } = get()
      set({ project: { ...project, export: { ...project.export, ...patch } } })
    },

    setExportOpen: (exportOpen) => set({ exportOpen }),
    setBoardEditor: (boardEditor) => set({ boardEditor }),
    setPicking: (picking) => set({ picking }),
    setVolume(volume) {
      const v = Math.min(1, Math.max(0, volume))
      set({ volume: v, lastVolume: v > 0 ? v : get().lastVolume })
      try {
        localStorage.setItem('reframe.volume', String(v))
      } catch {
        // Not persisted; fine.
      }
    },
    showHud: (text) => set({ hud: { text, n: (get().hud?.n ?? 0) + 1 } }),

    undo() {
      const { past, project, future, boardId } = get()
      const prev = past[past.length - 1]
      if (!prev) return
      lastCommit = 0
      const keep = prev.artboards.some((b) => b.id === boardId)
      set({ project: prev, past: past.slice(0, -1), future: [project, ...future], boardId: keep ? boardId : prev.artboards[0].id })
      get().showHud('Undo')
    },

    redo() {
      const { past, project, future, boardId } = get()
      const next = future[0]
      if (!next) return
      lastCommit = 0
      const keep = next.artboards.some((b) => b.id === boardId)
      set({ project: next, past: [...past, project], future: future.slice(1), boardId: keep ? boardId : next.artboards[0].id })
      get().showHud('Redo')
    }
  }
})

export const useBoard = (): Artboard => {
  const project = useStore((s) => s.project)
  const boardId = useStore((s) => s.boardId)
  return project.artboards.find((b) => b.id === boardId) ?? project.artboards[0]
}

export const hasOverrides = (board: Artboard, name: string): boolean =>
  Object.keys(board.overrides[name] ?? {}).length > 0

export const clipFor = (project: ProjectFile, name: string, duration: number): { start: number; end: number } => {
  const c = project.clips[name]
  return { start: c?.start ?? 0, end: c?.end ?? duration }
}

/** An asset's file name, without the folders it's in ("Shoot A/clip.mp4" → "clip.mp4"). */
export const baseName = (name: string): string => name.slice(name.lastIndexOf('/') + 1)

/** The folder an asset is in, relative to the open one ("" for the top level). */
export const folderOf = (name: string): string => name.slice(0, Math.max(0, name.lastIndexOf('/')))

const natural = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })

/**
 * A folder in the grid: its own assets (filtered and sorted) and its subfolders, as the tree it is
 * on disk. `count` is everything inside it. Excluded folders are leaves, marked with why.
 */
export interface FolderNode {
  /** Relative path, "/"-separated; "" is the top level's own files. */
  folder: string
  name: string
  assets: Asset[]
  children: FolderNode[]
  count: number
  collapsed: boolean
  excluded?: SkippedFolder
}

type LayoutInput = Pick<State, 'assets' | 'project' | 'boardId' | 'viewPrefs' | 'collapsed' | 'skipped'>

/**
 * What the grid shows, from the assets and the view options. Grouped, a tree of folders: the top
 * level's own files first (if any), then each top-level folder with its subfolders inside it.
 * Not grouped, one node holding everything. Also the flat list of visible assets in on-screen
 * order (a folder's files, then its subfolders; nothing inside a collapsed folder), which the
 * filmstrip, arrow keys, Select All, shift-click ranges and the export dialog's "Visible" scope
 * all follow.
 */
export function layout(s: LayoutInput): { tree: FolderNode[]; visible: Asset[] } {
  const { filter, sort, group } = s.viewPrefs
  const board = s.project.artboards.find((b) => b.id === s.boardId) ?? s.project.artboards[0]
  const pass = (a: Asset) =>
    filter === 'images'
      ? a.kind === 'image'
      : filter === 'videos'
        ? a.kind === 'video'
        : filter === 'adjusted'
          ? !!board && hasOverrides(board, a.name)
          : filter === 'excluded'
            ? !!board && resolveSettings(board, a.name).skip
            : true
  const byName = (a: Asset, b: Asset) => natural(baseName(a.name), baseName(b.name)) || natural(folderOf(a.name), folderOf(b.name))
  const cmp =
    sort === 'date'
      ? (a: Asset, b: Asset) => b.mtime - a.mtime || byName(a, b)
      : sort === 'type'
        ? (a: Asset, b: Asset) => natural(a.kind, b.kind) || byName(a, b)
        : byName
  const node = (folder: string): FolderNode => ({
    folder,
    name: folder.slice(folder.lastIndexOf('/') + 1),
    assets: [],
    children: [],
    count: 0,
    collapsed: s.collapsed.includes(folder)
  })
  if (!group) {
    const all = { ...node(''), collapsed: false, assets: s.assets.filter(pass).sort(cmp) }
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
  for (const a of s.assets) {
    if (!pass(a)) continue
    const folder = folderOf(a.name)
    ;(folder ? ensure(folder) : top).assets.push(a)
  }
  for (const f of s.skipped) ensure(f.path).excluded = f
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

  const visible: Asset[] = []
  const walk = (n: FolderNode) => {
    if (n.collapsed || n.excluded) return
    visible.push(...n.assets)
    n.children.forEach(walk)
  }
  tree.forEach(walk)
  return { tree, visible }
}

/** The visible assets, in on-screen order, for components (see layout). */
export function useVisible(): Asset[] {
  const assets = useStore((s) => s.assets)
  const project = useStore((s) => s.project)
  const boardId = useStore((s) => s.boardId)
  const viewPrefs = useStore((s) => s.viewPrefs)
  const collapsed = useStore((s) => s.collapsed)
  const skipped = useStore((s) => s.skipped)
  return useMemo(
    () => layout({ assets, project, boardId, viewPrefs, collapsed, skipped }).visible,
    [assets, project, boardId, viewPrefs, collapsed, skipped]
  )
}

/** After the view changes, nothing hidden stays selected (edits would land on assets out of sight). */
function keepVisibleSelection(): void {
  const st = useStore.getState()
  const visible = new Set(layout(st).visible.map((a) => a.name))
  const selection = st.selection.filter((n) => visible.has(n))
  const focus = st.focus && visible.has(st.focus) ? st.focus : selection[0] ?? null
  useStore.setState({ selection, focus })
}
