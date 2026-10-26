import { slotKey, type Dir } from '@shared/grid'
import type { CropSettings, FolderScan, GridSlot, SettingKey } from '@shared/types'
import { api } from '../lib/bridge'
import { hint } from '../lib/keymap.svelte'
import { plural } from '../lib/format'
import { showToast } from '../ui'
import { items } from './items.svelte'
import { library } from './library.svelte'
import * as model from './model/items'
import { baseName } from './model/tree'
import { FRAMING_KEYS, hasOverrides } from './model/project'
import type { ViewPrefs } from './prefs'
import { project } from './project.svelte'
import { selection } from './selection.svelte'
import { shell } from './shell.svelte'
import { view, type Mode } from './view.svelte'
import { GLOBAL, GRID } from '../features/keymaps'

/**
 * What the app does across more than one store, or with the main process, or saying so in a
 * toast. Each store changes only itself; anything that touches several goes through here.
 */

const undoHint = `${hint(GLOBAL.actions.undo)} to undo`
const GRID_OPEN = GRID.actions.open

// ---- the folder

let opening = 0
/**
 * Opens a folder (asking which, without `path`). Not while exporting (the export reads the open
 * folder). Opens can overlap (the launch reopening the last folder while another is picked); only
 * the newest one's result is applied.
 */
export async function openFolder(path?: string): Promise<void> {
  if (shell.exportOpen) return
  const n = ++opening
  const scan = await (path ? api.scanFolder(path) : api.openFolder()).catch(() => null)
  if (scan && n === opening) show(scan)
}

/** A scanned folder, freshly opened: its assets, its project, nothing selected. */
function show(scan: FolderScan): void {
  library.open(scan)
  project.load(scan.project)
  view.open(scan.dir)
  selection.clear()
}

/**
 * Scans the open folder again and applies the result (the main process runs one scan at a time
 * and hands every caller the newest). Ignored if another folder was opened meanwhile.
 */
export async function rescanFolder(): Promise<void> {
  const scan = await api.rescanFolder().catch(() => null)
  if (!scan || scan.dir !== library.dir) return
  library.rescan(scan)
  keepSelectionIn(items.all.map((a) => a.name))
}

/** Leaves a folder (and everything in it) out of the project; its bar stays, dimmed, to bring it back. */
export async function excludeFolder(folder: string): Promise<void> {
  await api.excludeFolder(folder)
  await rescanFolder()
  showToast(`Excluded “${baseName(folder)}” · right-click its bar to bring it back`)
}

/** Brings an excluded (or export) folder back into the project. */
export async function includeFolder(folder: string): Promise<void> {
  await api.includeFolder(folder)
  await rescanFolder()
  showToast(`Included “${baseName(folder)}”`)
}

// ---- the view

/** Grid or single. The single view needs something to show: the selection's first, or the first there is. */
export function setMode(mode: Mode): void {
  if (mode === 'single' && !selection.focus) {
    const first = selection.names[0] ?? view.visible[0]?.name
    if (!first) return
    selection.set(selection.size ? selection.names : [first])
    selection.focus = first
  }
  view.mode = mode
}

// After the view changes, nothing hidden stays selected (edits would land on assets out of sight).

export function setViewPrefs(patch: Partial<ViewPrefs>): void {
  view.setPrefs(patch)
  keepSelectionVisible()
}

export function resetView(): void {
  view.reset()
  keepSelectionVisible()
}

export function toggleCollapsed(folder: string): void {
  view.setCollapsed(view.collapsed.includes(folder) ? view.collapsed.filter((f) => f !== folder) : [...view.collapsed, folder])
  keepSelectionVisible()
}

/** Folds away every folder, or none. */
export function collapseAll(collapse: boolean): void {
  view.setCollapsed(collapse ? library.folders : [])
  keepSelectionVisible()
}

const keepSelectionVisible = () => keepSelectionIn(view.visible.map((a) => a.name))

/** The selection reduced to `names`; with nothing left in focus, back to the grid. */
function keepSelectionIn(names: string[]): void {
  selection.keepOnly(new Set(names))
  if (!selection.focus) view.mode = 'grid'
}

/** Nothing selected. In single view the focused asset stays on screen; the inspector shows the defaults. */
export function clearSelection(): void {
  selection.clear(view.mode === 'single')
}

// ---- editing: the selection, or with nothing selected, the artboard's defaults. In a grid, the
// slot being edited.

/** The slot being edited in the grid on screen, by its key in the overrides. */
export function editingSlot(): string | null {
  return view.mode === 'single' && selection.focus && selection.slot ? slotKey(selection.focus, selection.slot) : null
}

const isGrid = (key: string) => items.entry(key)?.kind === 'grid'

/**
 * What edits apply to: the slot being edited in a grid, or else the selection. A grid has no
 * framing of its own (its slots do), so of the settings it only takes being left out of an export.
 */
export function targets(patch?: Partial<CropSettings>): string[] {
  const slot = editingSlot()
  if (slot) return [slot]
  const framing = !patch || Object.keys(patch).some((k) => k !== 'skip')
  return framing ? selection.names.filter((n) => !isGrid(n)) : selection.names
}

/** Edits the targets; nothing at all when only grids are selected (rather than the defaults). */
export function edit(patch: Partial<CropSettings>): void {
  const names = targets(patch)
  if (names.length || !selection.size) project.edit(names, patch)
}

export function editEach(fn: (s: CropSettings) => Partial<CropSettings>): void {
  const names = targets()
  if (names.length || !selection.size) project.editEach(names, fn)
}

/** Back to the defaults for `keys` (an asset's override goes; a default goes back to the built-in value). */
export function resetKeys(keys: SettingKey[]): void {
  const names = targets()
  if (names.length || !selection.size) project.resetKeys(names, keys)
}

/** The focused asset's values for `keys` become the defaults; the selection then follows them. */
export function makeDefault(keys: SettingKey[]): void {
  const names = targets()
  if (!names.length || editingSlot()) return
  const source = selection.focus && names.includes(selection.focus) ? selection.focus : names[0]
  project.makeDefault(source, names, keys)
  showToast(`Now the default for ${project.board.name}`)
}

/**
 * Back to the artboard's framing for every selected asset; undoable, and says so. Whether each is
 * exported stays as it is.
 */
export function resetSelection(): void {
  const names = targets().filter((n) => hasOverrides(project.board, n))
  if (!names.length) return
  project.resetKeys(names, FRAMING_KEYS)
  showToast(`Reset ${names.length === 1 ? (items.entry(names[0])?.label ?? 'cell') : `${names.length} assets`} · ${undoHint}`)
}

export function copy(): void {
  const from = editingSlot() ?? selection.focus
  if (!from || isGrid(from)) return
  const n = project.copy(from)
  showToast(n ? `Copied ${n} setting${n === 1 ? '' : 's'}` : 'Copied defaults')
}

export function paste(): void {
  const names = targets()
  if (project.paste(names)) showToast(names.length > 1 ? `Pasted to ${names.length} items` : 'Pasted')
}

// ---- variants and grids

/** The selection in on-screen order. */
const inOrder = (names: string[]) => view.visible.filter((e) => names.includes(e.name)).map((e) => e.name)

/** Copies of the selected items, selected in their place: variants of files, and copies of grids. */
export function duplicateSelection(): void {
  const keys = inOrder(selection.names)
  if (!keys.length) return
  let made: string[] = []
  project.change((f) => {
    const r = model.duplicate(f, keys, project.boardId)
    made = r.keys
    return r.file
  })
  selection.set(made)
  const others = project.file.artboards.length > 1 ? ` · left out of other artboards` : ''
  showToast(`Duplicated ${made.length === 1 ? `as “${items.entry(made[0])?.label}”` : plural(made.length, 'item')}${others}`)
}

/** A new grid of the selected assets (in on-screen order), selected. */
export function combineSelection(): void {
  const members = inOrder(selection.names).filter((n) => !isGrid(n))
  if (!members.length) return
  let key = ''
  project.change((f) => {
    const r = model.combine(f, members, project.board.defaults.bgColor)
    key = r.key
    return r.file
  })
  selection.set([key])
  selection.focus = key
  showToast(`Made “${items.entry(key)?.label}” · ${hint(GRID_OPEN)} to arrange it`)
}

/** Adds the selected assets to the end of a grid. */
export function addToGrid(key: string): void {
  const members = inOrder(selection.names).filter((n) => !isGrid(n))
  if (!members.length) return
  project.change((f) => model.append(f, key, members))
  showToast(`Added ${plural(members.length, 'item')} to “${items.entry(key)?.label}”`)
}

/** Deletes the selected variants and grids (files stay: they're the folder's). */
export function deleteSelection(): void {
  const keys = selection.names.filter(model.isVirtual)
  if (!keys.length) return
  const label = keys.length === 1 ? `“${items.entry(keys[0])?.label}”` : plural(keys.length, 'item')
  const grids = model.gridsShowing(project.file, keys)
  project.change((f) => model.remove(f, keys))
  selection.keepOnly(new Set(view.visible.map((e) => e.name)))
  if (!selection.focus) view.mode = 'grid'
  showToast(`Deleted ${label}${grids ? `, emptying slots in ${plural(grids, 'grid')}` : ''} · ${undoHint}`)
}

export function renameItem(key: string, name: string): void {
  const n = name.trim()
  if (n) project.change((f) => model.rename(f, key, n))
}

// ---- grid slots (in the single view, on the grid in focus)

const focusGrid = () => (selection.focus && isGrid(selection.focus) ? selection.focus : null)

/** A new empty slot beside or below the one being edited, ready to fill. */
export function splitSlot(dir: Dir): void {
  const grid = focusGrid()
  const slot = selection.slot
  if (!grid || !slot) return
  let made = ''
  project.change((f) => {
    const r = model.splitSlot(f, grid, slot, dir, project.boardId)
    made = r.slot
    return r.file
  })
  selection.slot = made
  shell.choosing = made
}

export function removeSlot(): void {
  const grid = focusGrid()
  const slot = selection.slot
  if (!grid || !slot) return
  project.change((f) => model.removeSlot(f, grid, slot))
  selection.slot = null
}

export function swapSlots(a: string, b: string): void {
  const grid = focusGrid()
  if (grid) project.change((f) => model.swapSlots(f, grid, a, b))
}

/** What a slot shows (its framing starts over), or how it ends. */
export function setSlot(slot: string, patch: Partial<Omit<GridSlot, 'id'>>): void {
  const grid = focusGrid()
  if (grid) project.change((f) => model.setSlot(f, grid, slot, patch))
}

export function undo(): void {
  if (project.undo()) showToast('Undo')
}

export function redo(): void {
  if (project.redo()) showToast('Redo')
}

// ---- artboards

export function duplicateBoard(id: string): void {
  project.duplicateBoard(id)
  shell.editingBoard = null
}

/** Deletes an artboard, saying how to get it back. */
export function deleteBoard(id: string): void {
  const board = project.file.artboards.find((b) => b.id === id)
  if (!board || project.file.artboards.length < 2) return
  project.removeBoard(id)
  shell.editingBoard = null
  showToast(`Deleted “${board.name}” · ${undoHint}`)
}

/** A new artboard; a custom one opens its editor. */
export function addBoard(name: string, width: number, height: number, edit = false): void {
  const board = project.addBoard(name, width, height)
  if (edit) shell.editingBoard = board.id
}
