import {
  canUngroup,
  findNode,
  flipSplit,
  insertBeside,
  isSplit,
  moveNode as moveTreeNode,
  parentOf,
  removeNode as removeTreeNode,
  setSplitDir,
  slotKey,
  ungroup as ungroupTree,
  type Dir,
  type Side
} from '@shared/composition/bento'
import type { CropSettings, FolderScan, Slot, SettingKey } from '@shared/types'
import { api } from '../lib/bridge'
import { hint } from '../lib/keymap.svelte'
import { fmtSize, plural } from '../lib/format'
import { copies } from './playback.svelte'
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
import { GLOBAL, GRID } from '../config/keymaps'

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

/**
 * Empties the caches (posters and playback copies, for every folder); they're made again as
 * they're needed.
 */
export async function clearCache(): Promise<void> {
  const freed = await api.clearCache().catch(() => 0)
  copies.reset()
  showToast(`Cleared ${fmtSize(freed)} of cache · videos are prepared again as they're needed`)
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

// ---- editing: the selection, or with nothing selected, the artboard's defaults. In a composition, the
// slot being edited.

/** The cell selected in the composition on screen (not a group), by its key in the overrides. */
export function editingSlot(): string | null {
  const focus = selection.focus
  const node = selection.node
  if (view.mode !== 'single' || !focus || !node) return null
  const root = model.compositionOf(project.file, focus)?.root
  const found = root && findNode(root, node)
  return found && !isSplit(found) ? slotKey(focus, node) : null
}

const isComposition = (key: string) => items.entry(key)?.kind === 'composition'

/**
 * What edits apply to: the slot being edited in a composition, or else the selection. A composition has no
 * framing of its own (its slots do), so of the settings it only takes being left out of an export.
 */
export function targets(patch?: Partial<CropSettings>): string[] {
  const slot = editingSlot()
  if (slot) return [slot]
  const framing = !patch || Object.keys(patch).some((k) => k !== 'skip')
  return framing ? selection.names.filter((n) => !isComposition(n)) : selection.names
}

/** Edits the targets; nothing at all when only compositions are selected (rather than the defaults). */
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
  if (!from || isComposition(from)) return
  const n = project.copy(from)
  showToast(n ? `Copied ${n} setting${n === 1 ? '' : 's'}` : 'Copied defaults')
}

export function paste(): void {
  const names = targets()
  if (project.paste(names)) showToast(names.length > 1 ? `Pasted to ${names.length} items` : 'Pasted')
}

// ---- variants and compositions

/** The selection in on-screen order. */
const inOrder = (names: string[]) => view.visible.filter((e) => names.includes(e.name)).map((e) => e.name)

/** Copies of the selected items, selected in their place: variants of files, and copies of compositions. */
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

/** A new composition of the selected assets (in on-screen order), selected. */
export function combineSelection(): void {
  const members = inOrder(selection.names).filter((n) => !isComposition(n))
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

/** Adds the selected assets to the end of a composition. */
export function addToComposition(key: string): void {
  const members = inOrder(selection.names).filter((n) => !isComposition(n))
  if (!members.length) return
  project.change((f) => model.append(f, key, members))
  showToast(`Added ${plural(members.length, 'item')} to “${items.entry(key)?.label}”`)
}

/** Deletes the selected variants and compositions (files stay: they're the folder's). */
export function deleteSelection(): void {
  const keys = selection.names.filter(model.isVirtual)
  if (!keys.length) return
  const label = keys.length === 1 ? `“${items.entry(keys[0])?.label}”` : plural(keys.length, 'item')
  const compositions = model.compositionsShowing(project.file, keys)
  project.change((f) => model.remove(f, keys))
  selection.keepOnly(new Set(view.visible.map((e) => e.name)))
  if (!selection.focus) view.mode = 'grid'
  showToast(`Deleted ${label}${compositions ? `, emptying cells in ${plural(compositions, 'composition')}` : ''} · ${undoHint}`)
}

export function renameItem(key: string, name: string): void {
  const n = name.trim()
  if (n) project.change((f) => model.rename(f, key, n))
}

// ---- composition slots (in the single view, on the composition in focus)

const focusComposition = () => (selection.focus && isComposition(selection.focus) ? selection.focus : null)

/** The tree of the composition in focus, changed by `change` (see model.restructure). */
function restructure(change: Parameters<typeof model.restructure>[3]): void {
  const composition = focusComposition()
  if (composition) project.change((f) => model.restructure(f, composition, project.boardId, change))
}

const treeOf = () => {
  const c = focusComposition()
  return c ? model.compositionOf(project.file, c)?.root : undefined
}

/** A new empty cell on `side` of node `target` (a cell or a group), selected, ready to fill. */
export function addCell(target: string, side: Side): void {
  const cell: Slot = { id: model.newSlotId(), item: null }
  restructure((root, dirOf) => insertBeside(root, target, side, cell, dirOf, model.newSlotId))
  if (treeOf() && findNode(treeOf()!, cell.id)) selection.node = cell.id
}

/** Node `id` moved to `side` of node `target`; it stays selected. */
export function moveNode(id: string, target: string, side: Side): void {
  restructure((root, dirOf) => moveTreeNode(root, id, target, side, dirOf, model.newSlotId))
  selection.node = id
}

/** Removes a cell or a group (the selection, unless given); its group closes up behind it. */
export function removeNode(id = selection.node): void {
  if (!id) return
  restructure((root) => ({ root: removeTreeNode(root, id) }))
  selection.node = null
}

/** The group around the selection selected instead (none around it: the composition). */
export function selectParent(): void {
  const root = treeOf()
  const node = selection.node
  if (root && node) selection.node = parentOf(root, node)?.id ?? null
}

/** A group running the other way. */
export function flipGroup(id: string): void {
  restructure((root, dirOf) => ({ root: flipSplit(root, id, dirOf) }))
}

/** A group's direction (null: Auto, following each artboard's shape). */
export function setGroupDir(id: string, dir: Dir | null): void {
  restructure((root) => ({ root: setSplitDir(root, id, dir ?? undefined) }))
}

/** Whether a group can be dissolved into the one around it (they run the same way). */
export function canUngroupNode(id: string): boolean {
  const root = treeOf()
  const composition = focusComposition()
  const board = project.board
  if (!root || !composition) return false
  const placed = model.placedOn(project.file, composition, board)
  return !!placed && canUngroup(root, id, placed)
}

/** A group dissolved into the one around it; what was in it stays selected as the parent. */
export function ungroupNode(id: string): void {
  const parent = treeOf() && parentOf(treeOf()!, id)
  restructure((root, dirOf) => ({ root: ungroupTree(root, id, dirOf) }))
  selection.node = parent?.id ?? null
}

/** A group's cells sharing its space equally again, on this artboard. */
export function evenOut(id: string): void {
  const composition = focusComposition()
  if (composition) project.change((f) => model.evenOut(f, composition, project.boardId, id))
}

export function swapSlots(a: string, b: string): void {
  const composition = focusComposition()
  if (composition) project.change((f) => model.swapSlots(f, composition, a, b))
}

/** What a slot shows (its framing starts over), or how it ends. */
export function setSlot(slot: string, patch: Partial<Omit<Slot, 'id'>>): void {
  const composition = focusComposition()
  if (composition) project.change((f) => model.setSlot(f, composition, slot, patch))
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
