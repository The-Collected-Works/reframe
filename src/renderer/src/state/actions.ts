import type { CropSettings, FolderScan, SettingKey } from '@shared/types'
import { api } from '../lib/bridge'
import { hint } from '../lib/keymap.svelte'
import { showToast } from '../ui'
import { library } from './library.svelte'
import { baseName } from './model/tree'
import { FRAMING_KEYS, hasOverrides } from './model/project'
import type { ViewPrefs } from './prefs'
import { project } from './project.svelte'
import { selection } from './selection.svelte'
import { shell } from './shell.svelte'
import { view, type Mode } from './view.svelte'
import { GLOBAL } from '../features/keymaps'

/**
 * What the app does across more than one store, or with the main process, or saying so in a
 * toast. Each store changes only itself; anything that touches several goes through here.
 */

const undoHint = `${hint(GLOBAL.actions.undo)} to undo`

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
  keepSelectionIn(scan.assets.map((a) => a.name))
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

// ---- editing: the selection, or with nothing selected, the artboard's defaults

export function edit(patch: Partial<CropSettings>): void {
  project.edit(selection.names, patch)
}

export function editEach(fn: (s: CropSettings) => Partial<CropSettings>): void {
  project.editEach(selection.names, fn)
}

/** Back to the defaults for `keys` (an asset's override goes; a default goes back to the built-in value). */
export function resetKeys(keys: SettingKey[]): void {
  project.resetKeys(selection.names, keys)
}

/** The focused asset's values for `keys` become the defaults; the selection then follows them. */
export function makeDefault(keys: SettingKey[]): void {
  const names = selection.names
  if (!names.length) return
  const source = selection.focus && selection.has(selection.focus) ? selection.focus : names[0]
  project.makeDefault(source, names, keys)
  showToast(`Now the default for ${project.board.name}`)
}

/**
 * Back to the artboard's framing for every selected asset; undoable, and says so. Whether each is
 * exported stays as it is.
 */
export function resetSelection(): void {
  const names = selection.names.filter((n) => hasOverrides(project.board, n))
  if (!names.length) return
  project.resetKeys(names, FRAMING_KEYS)
  showToast(`Reset ${names.length === 1 ? baseName(names[0]) : `${names.length} assets`} · ${undoHint}`)
}

export function copy(): void {
  if (!selection.focus) return
  const n = project.copy(selection.focus)
  showToast(n ? `Copied ${n} setting${n === 1 ? '' : 's'}` : 'Copied defaults')
}

export function paste(): void {
  const n = selection.size
  if (project.paste(selection.names)) showToast(n > 1 ? `Pasted to ${n} items` : 'Pasted')
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
