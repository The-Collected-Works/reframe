import { SvelteMap } from 'svelte/reactivity'
import { resolveSettings } from '@shared/layout'
import type { Artboard, AssetEntry, Clip, ColorMeta, CropSettings, ExportPrefs, FolderScan, ProjectFile, SettingKey, SkippedFolder } from '@shared/types'
import { showToast } from '../ui/toast.svelte'
import { folderOf, layout } from './library'
import { hydrate } from './loading'
import { storeCollapsed, storedCollapsed, storedView, storedVolume, storeView, storeVolume, VIEW_DEFAULTS, type ViewPrefs } from './prefs'
import { changes, emptyProject, FRAMING_KEYS, newBoard, normalizeProject, uid, withOverrides, withoutOverrides } from './project'

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

export type View = 'grid' | 'single'

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
    this.focus = this.focus && keep.has(this.focus) ? this.focus : (this.selection[0] ?? null)
    if (!this.focus) this.view = 'grid'
  }

  /** After the view changes, nothing hidden stays selected (edits would land on assets out of sight). */
  #keepVisibleSelection() {
    this.#prune(new Set(this.visible.map((a) => a.name)))
  }

  #setCollapsed(next: string[]) {
    this.collapsed = next
    if (this.dir) storeCollapsed(this.dir, next)
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
    hydrate(
      scan.assets.filter((e) => !this.meta.has(e.name)),
      false
    )
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
    storeView(this.viewPrefs)
    this.#keepVisibleSelection()
  }

  /** Default filter, sort, grouping and captions, and every folder open. */
  resetView() {
    this.viewPrefs = { ...VIEW_DEFAULTS }
    storeView(VIEW_DEFAULTS)
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
      this.focus = has ? (next[next.length - 1] ?? null) : name
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
    this.focus = this.focus && names.includes(this.focus) ? this.focus : (names[0] ?? null)
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
    showToast(`Now the default for ${board.name}`)
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
    showToast(n ? `Copied ${n} setting${n === 1 ? '' : 's'}` : 'Copied defaults')
  }

  paste() {
    const { clipboard, selection } = this
    if (!clipboard || !selection.length) return
    this.#mapBoard((b) => withOverrides(withoutOverrides(b, selection, FRAMING_KEYS), selection, clipboard))
    showToast(selection.length > 1 ? `Pasted to ${selection.length} items` : 'Pasted')
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
    storeVolume(v)
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
    showToast('Undo')
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
    showToast('Redo')
  }

  /** An asset's settings on the current artboard (its overrides over the defaults). */
  settingsOf(name: string): CropSettings {
    return resolveSettings(this.board, name)
  }

  /** An asset with what's been loaded about it. */
  asset(name: string | null): Asset | undefined {
    const entry = name ? this.assets.find((a) => a.name === name) : undefined
    return entry && withMeta(entry, this.meta.get(entry.name))
  }
}

export const app = new AppState()
