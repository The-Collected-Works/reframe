import { SvelteMap } from 'svelte/reactivity'
import { DEFAULT_SETTINGS, resolveSettings } from '@shared/layout'
import type { IconName } from '../ui/icons'
import type { Artboard, AssetEntry, Clip, ColorMeta, CropSettings, ExportPrefs, FolderScan, ProjectFile, SettingKey, SkippedFolder } from '@shared/types'
import { hydrate } from './loading'

/**
 * What loading an asset finds out (size, timing, colour, thumbnail). Kept apart from the scanned
 * list (`assets`), so thumbnails arriving never change the list everything is sorted and laid out
 * from; each thumbnail reads its own entry.
 */
export interface AssetMeta {
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

/** A scanned asset together with what's been loaded about it. */
export type Asset = AssetEntry & AssetMeta

const NO_META: AssetMeta = { w: 0, h: 0, duration: 0, thumb: null, error: false }

export const withMeta = (entry: AssetEntry, meta: AssetMeta | undefined): Asset => ({ ...entry, ...(meta ?? NO_META) })

type View = 'grid' | 'single'

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

function newBoard(name: string, width: number, height: number, defaults: CropSettings = DEFAULT_SETTINGS): Artboard {
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

const FILTERS: FilterKey[] = ['all', 'images', 'videos', 'adjusted', 'excluded']
const SORTS: SortKey[] = ['name', 'date', 'type']

/** Stored view options, each checked (a value from another version falls back to the default). */
function storedView(): ViewPrefs {
  const v = read<Partial<ViewPrefs>>('reframe.view', {})
  return {
    filter: FILTERS.includes(v.filter as FilterKey) ? (v.filter as FilterKey) : VIEW_DEFAULTS.filter,
    sort: SORTS.includes(v.sort as SortKey) ? (v.sort as SortKey) : VIEW_DEFAULTS.sort,
    group: typeof v.group === 'boolean' ? v.group : VIEW_DEFAULTS.group,
    names: typeof v.names === 'boolean' ? v.names : VIEW_DEFAULTS.names
  }
}
const storedCollapsed = (dir: string): string[] => {
  const v = read<unknown>('reframe.collapsed:' + dir, [])
  return Array.isArray(v) ? v.filter((f): f is string => typeof f === 'string') : []
}

function storedVolume(): number {
  const v = Number(read<unknown>('reframe.volume', 0.8))
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.8
}

/** Whether applying `patch` to `o` would change it. */
const changes = <T extends object>(o: T | undefined, patch: Partial<T>) => Object.entries(patch).some(([k, v]) => !o || o[k as keyof T] !== v)

// An override is set by editing an asset and removed only by an explicit reset, even if its value
// happens to equal the default, so it never silently starts following defaults. The overrides map
// is copied once, however many assets change.
function withOverrides(b: Artboard, names: string[], patch: Partial<CropSettings> | ((name: string) => Partial<CropSettings>)): Artboard {
  let overrides: Artboard['overrides'] | null = null
  for (const name of names) {
    const p = typeof patch === 'function' ? patch(name) : patch
    if (!changes(b.overrides[name], p) && b.overrides[name]) continue
    overrides ??= { ...b.overrides }
    overrides[name] = { ...b.overrides[name], ...p }
    if (!Object.keys(overrides[name]).length) delete overrides[name]
  }
  return overrides ? { ...b, overrides } : b
}

function withoutOverrides(b: Artboard, names: string[], keys: SettingKey[]): Artboard {
  let overrides: Artboard['overrides'] | null = null
  for (const name of names) {
    const current = b.overrides[name]
    if (!current || !keys.some((k) => k in current)) continue
    overrides ??= { ...b.overrides }
    const o = { ...current }
    for (const k of keys) delete o[k]
    if (Object.keys(o).length) overrides[name] = o
    else delete overrides[name]
  }
  return overrides ? { ...b, overrides } : b
}

/**
 * The app's state, and every change to it. Each field is reactive on its own (replaced, never
 * mutated), so whatever reads one updates only when that one changes; `meta` is per asset.
 */
class AppState {
  dir = $state.raw<string | null>(null)
  /** What the folder scan found, in folder order. */
  assets = $state.raw<AssetEntry[]>([])
  /** What's been loaded for each asset, by name (see AssetMeta). */
  meta = new SvelteMap<string, AssetMeta>()
  /** Subfolders the scan left out (exports, or excluded by the user). */
  skipped = $state.raw<SkippedFolder[]>([])
  /** The scan stopped at its file limit. */
  truncated = $state.raw(false)
  project = $state.raw<ProjectFile>(emptyProject())
  boardId = $state.raw('')
  selection = $state.raw<string[]>([])
  focus = $state.raw<string | null>(null)
  view = $state.raw<View>('grid')
  cellSize = $state.raw(220)
  /** How the grid shows assets (filter, sort, grouping, captions). Per user, remembered. */
  viewPrefs = $state.raw<ViewPrefs>(storedView())
  /** Folders folded away in the grid (with everything inside). Remembered per project folder. */
  collapsed = $state.raw<string[]>([])
  clipboard = $state.raw<Partial<CropSettings> | null>(null)
  past = $state.raw<ProjectFile[]>([])
  future = $state.raw<ProjectFile[]>([])
  exportOpen = $state.raw(false)
  boardEditor = $state.raw<string | null>(null)
  /** Eyedropper armed: the next click on media samples the background colour. */
  picking = $state.raw(false)
  /** Brief confirmation shown over the content (copy, paste, undo). `n` restarts it. */
  hud = $state.raw<{ text: string; n: number } | null>(null)
  /** The open context menu (see menus.ts / ContextMenu.svelte). */
  contextMenu = $state.raw<{ x: number; y: number; items: AppMenuItem[] } | null>(null)
  /** Preview playback volume, shared by every video and remembered between sessions. */
  volume = $state.raw(storedVolume())
  lastVolume = $state.raw(storedVolume() || 0.8)

  /** The artboard being edited. */
  board = $derived(this.project.artboards.find((b) => b.id === this.boardId) ?? this.project.artboards[0])
  /** The selection as a set, for asking whether one asset is in it. */
  selected = $derived(new Set(this.selection))

  /**
   * What the grid shows (see layout). Edits count only when the filter looks at them (Adjusted,
   * Excluded from export), so dragging a slider never re-sorts anything.
   */
  #edits = $derived(this.viewPrefs.filter === 'adjusted' || this.viewPrefs.filter === 'excluded' ? this.board : null)
  layout = $derived(layout(this.assets, this.viewPrefs, this.collapsed, this.skipped, this.#edits))
  /** The visible assets, in on-screen order. */
  get visible(): AssetEntry[] {
    return this.layout.visible
  }

  /** The last commit (time and what it edited), so a drag or slider is one undo step. */
  #lastCommit = { at: 0, key: '' }

  /**
   * Applies a project change. A change that changes nothing (the artboard editor closing with the
   * same name, say) isn't recorded, so it can't clear redo. Successive changes of the same kind in
   * quick succession (`key`: one slider, one drag) make one undo step; anything else is its own.
   */
  #commit(next: ProjectFile, key = '') {
    if (next === this.project) return
    const now = performance.now()
    const merge = !!key && key === this.#lastCommit.key && now - this.#lastCommit.at < 600
    this.#lastCommit = { at: now, key }
    if (!merge) this.past = [...this.past.slice(-99), this.project]
    this.project = next
    this.future = []
  }

  /** Changes one artboard (the current one by default). Returning it unchanged changes nothing. */
  #mapBoard(fn: (b: Artboard) => Artboard, id = this.boardId, key = '') {
    const i = this.project.artboards.findIndex((b) => b.id === id)
    if (i < 0) return
    const board = fn(this.project.artboards[i])
    if (board === this.project.artboards[i]) return
    const artboards = [...this.project.artboards]
    artboards[i] = board
    this.#commit({ ...this.project, artboards }, key)
  }

  /** Selection and focus reduced to `keep`; leaving single view if nothing's in focus. */
  #prune(keep: Set<string>) {
    this.selection = this.selection.filter((n) => keep.has(n))
    this.focus = this.focus && keep.has(this.focus) ? this.focus : this.selection[0] ?? null
    if (!this.focus) this.view = 'grid'
  }

  /** After the view changes, nothing hidden stays selected (edits would land on assets out of sight). */
  #keepVisibleSelection() {
    this.#prune(new Set(this.visible.map((a) => a.name)))
  }

  #setCollapsed(next: string[]) {
    this.collapsed = next
    if (this.dir) store('reframe.collapsed:' + this.dir, next)
    this.#keepVisibleSelection()
  }

  load(scan: FolderScan) {
    const project = normalizeProject(scan.project)
    this.dir = scan.dir
    this.assets = scan.assets
    this.meta.clear()
    this.skipped = scan.skipped
    this.truncated = scan.truncated
    this.collapsed = storedCollapsed(scan.dir)
    this.project = project
    this.boardId = project.artboards[0].id
    this.selection = []
    this.focus = null
    this.view = 'grid'
    this.past = []
    this.future = []
    hydrate(scan.assets, true)
  }

  /** Unchanged files keep what's been loaded for them; changed ones load again. */
  rescan(scan: FolderScan) {
    const next = new Map(scan.assets.map((a) => [a.name, a]))
    for (const prev of this.assets) {
      const e = next.get(prev.name)
      if (!e || prev.mtime !== e.mtime || prev.size !== e.size) this.meta.delete(prev.name)
    }
    this.assets = scan.assets
    this.skipped = scan.skipped
    this.truncated = scan.truncated
    this.#prune(new Set(next.keys()))
    hydrate(scan.assets.filter((e) => !this.meta.has(e.name)), false)
  }

  /** Records what loading found, if `entry` is still the asset of that name (not a replaced file). */
  setMeta(entry: AssetEntry, patch: Partial<AssetMeta>) {
    const current = this.assets.find((a) => a.name === entry.name)
    if (!current || current.path !== entry.path || current.mtime !== entry.mtime) return
    this.meta.set(entry.name, { ...NO_META, ...this.meta.get(entry.name), ...patch })
  }

  setView(view: View) {
    if (view === 'single' && !this.focus) {
      const first = this.selection[0] ?? this.visible[0]?.name
      if (!first) return
      this.focus = first
      if (!this.selection.length) this.selection = [first]
    }
    this.view = view
  }

  setCellSize(n: number) {
    this.cellSize = n
  }

  setViewPrefs(patch: Partial<ViewPrefs>) {
    this.viewPrefs = { ...this.viewPrefs, ...patch }
    store('reframe.view', this.viewPrefs)
    this.#keepVisibleSelection()
  }

  /** Default filter, sort, grouping and captions, and every folder open. */
  resetView() {
    this.viewPrefs = { ...VIEW_DEFAULTS }
    store('reframe.view', VIEW_DEFAULTS)
    this.#setCollapsed([])
  }

  toggleCollapsed(folder: string) {
    this.#setCollapsed(this.collapsed.includes(folder) ? this.collapsed.filter((f) => f !== folder) : [...this.collapsed, folder])
  }

  /** Folds away every folder (including ones that only hold other folders), or none. */
  setAllCollapsed(collapse: boolean) {
    const folders = new Set<string>()
    for (const a of this.assets) for (let f = folderOf(a.name); f; f = folderOf(f)) folders.add(f)
    this.#setCollapsed(collapse ? [...folders] : [])
  }

  select(name: string, mode: 'replace' | 'toggle' | 'range' = 'replace') {
    const focus = this.focus
    if (mode === 'toggle') {
      const has = this.selected.has(name)
      const next = has ? this.selection.filter((n) => n !== name) : [...this.selection, name]
      this.selection = next
      this.focus = has ? next[next.length - 1] ?? null : name
    } else if (mode === 'range' && focus && this.visible.some((a) => a.name === focus)) {
      // A shift-click range covers what's on screen, in on-screen order (from a focus that's still
      // on screen; otherwise it's a plain click).
      const names = this.visible.map((a) => a.name)
      const [a, b] = [names.indexOf(focus), names.indexOf(name)].sort((x, y) => x - y)
      this.selection = names.slice(a, b + 1)
    } else {
      this.selection = [name]
      this.focus = name
    }
  }

  setSelection(names: string[]) {
    this.selection = names
    this.focus = this.focus && names.includes(this.focus) ? this.focus : names[0] ?? null
  }

  selectAll() {
    this.selection = this.visible.map((a) => a.name)
  }

  /** In single view the focused asset stays on screen; only the inspector switches to defaults. */
  clearSelection() {
    this.selection = []
    if (this.view !== 'single') this.focus = null
  }

  /** Through what's visible, in on-screen order (filtered, sorted, collapsed folders skipped). */
  step(delta: number) {
    const assets = this.visible
    if (!assets.length) return
    const i = this.focus ? assets.findIndex((a) => a.name === this.focus) : -1
    const next = assets[Math.max(0, Math.min(assets.length - 1, i + delta))].name
    this.selection = [next]
    this.focus = next
  }

  /** Edits defaults when nothing is selected, otherwise overrides on the selection. */
  edit(patch: Partial<CropSettings>) {
    const selection = this.selection
    const key = `edit:${Object.keys(patch).sort()}:${selection}`
    if (!selection.length) this.#mapBoard((b) => (changes(b.defaults, patch) ? { ...b, defaults: { ...b.defaults, ...patch } } : b), undefined, key)
    else this.#mapBoard((b) => withOverrides(b, selection, patch), undefined, key)
  }

  editAsset(name: string, patch: Partial<CropSettings>) {
    this.#mapBoard((b) => withOverrides(b, [name], patch), undefined, `edit:${Object.keys(patch).sort()}:${name}`)
  }

  /** Like edit(), but computes the patch from each target's current settings. */
  editEach(fn: (s: CropSettings) => Partial<CropSettings>) {
    const selection = this.selection
    if (!selection.length) return this.edit(fn(this.board.defaults))
    this.#mapBoard((b) => withOverrides(b, selection, (n) => fn(resolveSettings(b, n))))
  }

  /** Makes the focused asset's values for `keys` the artboard defaults; the selection then follows them. */
  makeDefault(keys: SettingKey[]) {
    const { selection, focus, board } = this
    if (!board || !selection.length) return
    const source = resolveSettings(board, focus && selection.includes(focus) ? focus : selection[0])
    const values = Object.fromEntries(keys.map((k) => [k, source[k]])) as Partial<CropSettings>
    this.#mapBoard((b) => withoutOverrides({ ...b, defaults: { ...b.defaults, ...values } }, selection, keys))
    this.showHud(`Now the default for ${board.name}`)
  }

  /** Removes overrides so the keys follow the defaults again. Defaults to the selection. */
  resetKeys(keys: SettingKey[], names = this.selection) {
    this.#mapBoard((b) => withoutOverrides(b, names, keys))
  }

  /**
   * Copies the asset's overrides (not its resolved values), so pasted assets keep following the
   * defaults for everything the source does.
   */
  copy() {
    if (!this.focus) return
    const { skip: _skip, ...overrides } = this.board.overrides[this.focus] ?? {}
    this.clipboard = overrides
    const n = Object.keys(overrides).length
    this.showHud(n ? `Copied ${n} setting${n === 1 ? '' : 's'}` : 'Copied defaults')
  }

  paste() {
    const { clipboard, selection } = this
    if (!clipboard || !selection.length) return
    this.#mapBoard((b) => withOverrides(withoutOverrides(b, selection, FRAMING_KEYS), selection, clipboard))
    this.showHud(selection.length > 1 ? `Pasted to ${selection.length} items` : 'Pasted')
  }

  setClip(name: string, clip: Clip | null) {
    const clips = { ...this.project.clips }
    if (clip && (clip.start > 0 || clip.end != null)) clips[name] = clip
    else delete clips[name]
    this.#commit({ ...this.project, clips })
  }

  setBoard(id: string) {
    this.boardId = id
  }

  addBoard(name: string, width: number, height: number) {
    const board = newBoard(name, width, height, this.board.defaults)
    this.#commit({ ...this.project, artboards: [...this.project.artboards, board] })
    this.boardId = board.id
  }

  updateBoard(id: string, patch: Partial<Pick<Artboard, 'name' | 'width' | 'height'>>) {
    this.#mapBoard((b) => (changes(b, patch) ? { ...b, ...patch } : b), id)
  }

  duplicateBoard(id: string) {
    const src = this.project.artboards.find((b) => b.id === id)
    if (!src) return
    const copy: Artboard = { ...structuredClone(src), id: uid(), name: `${src.name} copy` }
    const artboards = [...this.project.artboards]
    artboards.splice(artboards.indexOf(src) + 1, 0, copy)
    this.#commit({ ...this.project, artboards })
    this.boardId = copy.id
    this.boardEditor = null
  }

  removeBoard(id: string) {
    if (this.project.artboards.length < 2) return
    const artboards = this.project.artboards.filter((b) => b.id !== id)
    this.#commit({ ...this.project, artboards })
    if (this.boardId === id) this.boardId = artboards[0].id
    this.boardEditor = null
  }

  /** Export preferences aren't edits: they're saved with the project but never undone. */
  setExportPrefs(patch: Partial<ExportPrefs>) {
    this.project = { ...this.project, export: { ...this.project.export, ...patch } }
  }

  setExportOpen(open: boolean) {
    this.exportOpen = open
  }

  setBoardEditor(id: string | null) {
    this.boardEditor = id
  }

  setPicking(picking: boolean) {
    this.picking = picking
  }

  setVolume(volume: number) {
    const v = Math.min(1, Math.max(0, volume))
    this.volume = v
    if (v > 0) this.lastVolume = v
    store('reframe.volume', v)
  }

  showHud(text: string) {
    this.hud = { text, n: (this.hud?.n ?? 0) + 1 }
  }

  // Export preferences aren't edits: undo and redo leave them as they are.
  undo() {
    const prev = this.past[this.past.length - 1]
    if (!prev) return
    this.#lastCommit = { at: 0, key: '' }
    const project = this.project
    this.past = this.past.slice(0, -1)
    this.future = [project, ...this.future]
    this.project = { ...prev, export: project.export }
    if (!prev.artboards.some((b) => b.id === this.boardId)) this.boardId = prev.artboards[0].id
    this.showHud('Undo')
  }

  redo() {
    const next = this.future[0]
    if (!next) return
    this.#lastCommit = { at: 0, key: '' }
    const project = this.project
    this.past = [...this.past, project]
    this.future = this.future.slice(1)
    this.project = { ...next, export: project.export }
    if (!next.artboards.some((b) => b.id === this.boardId)) this.boardId = next.artboards[0].id
    this.showHud('Redo')
  }

  /** An asset with what's been loaded about it. */
  asset(name: string | null): Asset | undefined {
    const entry = name ? this.assets.find((a) => a.name === name) : undefined
    return entry && withMeta(entry, this.meta.get(entry.name))
  }
}

export const app = new AppState()

/**
 * Whether an asset's framing has been adjusted away from the artboard's defaults. Being left out
 * of the export isn't an adjustment: it's about the asset, not how it's framed.
 */
export const hasOverrides = (board: Artboard, name: string): boolean => Object.keys(board.overrides[name] ?? {}).some((k) => k !== 'skip')

/** Every setting that frames an asset (all but whether it's exported). */
export const FRAMING_KEYS = (Object.keys(DEFAULT_SETTINGS) as SettingKey[]).filter((k) => k !== 'skip')

export const clipFor = (project: ProjectFile, name: string, duration: number): { start: number; end: number } => {
  const c = project.clips[name]
  return { start: c?.start ?? 0, end: c?.end ?? duration }
}

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

type Layout = { tree: FolderNode[]; visible: AssetEntry[] }

/**
 * What the grid shows, from the assets and the view options. Grouped, a tree of folders: the top
 * level's own files first (if any), then each top-level folder with its subfolders inside it.
 * Not grouped, one node holding everything. Also the flat list of visible assets in on-screen
 * order (a folder's files, then its subfolders; nothing inside a collapsed folder), which the
 * filmstrip, arrow keys, Select All, shift-click ranges and the export dialog's "Visible" scope
 * all follow. `board` is only given when the filter looks at edits.
 */
function layout(assets: AssetEntry[], prefs: ViewPrefs, collapsed: string[], skipped: SkippedFolder[], board: Artboard | null): Layout {
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
