import { create } from 'zustand'
import { DEFAULT_SETTINGS, resolveSettings } from '@shared/layout'
import type { IconName } from './components/ui'
import type { Artboard, AssetEntry, Clip, ColorMeta, CropSettings, ExportPrefs, FolderScan, ProjectFile, SettingKey } from '@shared/types'

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
  project: ProjectFile
  boardId: string
  selection: string[]
  focus: string | null
  view: View
  cellSize: number
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
    assets: [],
    project: emptyProject(),
    boardId: '',
    selection: [],
    focus: null,
    view: 'grid',
    cellSize: 220,
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
      set({ assets, selection, focus, view: focus ? get().view : 'grid' })
    },

    patchAsset(name, patch) {
      set({ assets: get().assets.map((a) => (a.name === name ? { ...a, ...patch } : a)) })
    },

    setView(view) {
      const { focus, selection, assets } = get()
      if (view === 'loupe' && !focus) {
        const first = selection[0] ?? assets[0]?.name
        if (!first) return
        set({ focus: first, selection: selection.length ? selection : [first] })
      }
      set({ view })
    },

    setCellSize: (cellSize) => set({ cellSize }),

    select(name, mode = 'replace') {
      const { selection, focus, assets } = get()
      if (mode === 'toggle') {
        const has = selection.includes(name)
        const next = has ? selection.filter((n) => n !== name) : [...selection, name]
        set({ selection: next, focus: has ? next[next.length - 1] ?? null : name })
      } else if (mode === 'range' && focus) {
        const names = assets.map((a) => a.name)
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

    selectAll: () => set({ selection: get().assets.map((a) => a.name) }),
    // In single view the focused asset stays on screen; only the inspector switches to defaults.
    clearSelection: () => set({ selection: [], focus: get().view === 'loupe' ? get().focus : null }),

    step(delta) {
      const { assets, focus } = get()
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
