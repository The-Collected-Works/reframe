import { dirsOn, findNode, isSplit, parentOf } from '@shared/composition/bento'
import { resolveSettings } from '@shared/framing/framing'
import { api, mac, win } from '../lib/bridge'
import { fmtSize } from '../lib/format'
import { hint } from '../lib/keymap.svelte'
import { inside, join } from '../lib/paths'
import {
  addToComposition,
  clearCache,
  combineSelection,
  copy,
  deleteBoard,
  deleteSelection,
  duplicateBoard,
  duplicateSelection,
  edit,
  excludeFolder,
  includeFolder,
  paste,
  removeNode,
  selectParent,
  addCell,
  canGroupNodes,
  canUngroupNode,
  evenOut,
  flipGroup,
  groupNodes,
  ungroupNode,
  resetSelection,
  setMode,
  setSlot
} from '../state/actions'
import type { Composed } from '../state/composition'
import { items } from '../state/items.svelte'
import { library } from '../state/library.svelte'
import { isVirtual } from '../state/model/items'
import { hasOverrides } from '../state/model/project'
import { folderOf, COMPOSITIONS } from '../state/model/tree'
import { project } from '../state/project.svelte'
import { selection } from '../state/selection.svelte'
import { shell } from '../state/shell.svelte'
import { view } from '../state/view.svelte'
import { showMenu, type ContextMenuItem } from '../ui'
import { GLOBAL, GRID, COMPOSITION_EDITOR } from '../config/keymaps'

/** The right-click menus: on items (grid and single view), parts of compositions, artboard tabs, and folder headers. */

const revealLabel = mac ? 'Reveal in Finder' : win ? 'Show in Explorer' : 'Show in Folder'
const openLabel = mac ? 'Open in Finder' : win ? 'Open in Explorer' : 'Open in File Manager'

/** Right-click on the folder button in the title bar. */
export async function openFolderMenu(at: { x: number; y: number }): Promise<void> {
  const dir = library.dir
  if (!dir) return
  const size = await api.cacheSize().catch(() => 0)
  // Where exports go: chosen in the export dialog, or by default a folder inside this one (there
  // once Reframe has written to it, and marked as its output).
  const output = project.file.export.dir ?? join(dir, 'export')
  const exported = !!project.file.export.dir || library.skipped.some((f) => f.reason === 'export' && f.path === 'export')
  const id = await showMenu(at.x, at.y, [
    { id: 'open', label: openLabel, icon: 'reveal' },
    { id: 'output', label: 'Open Output Folder', icon: 'export', enabled: exported },
    { separator: true },
    // Thumbnails and playback copies, for every folder: made again as they're needed.
    { id: 'clear', label: size > 0 ? `Clear Cache · ${fmtSize(size)}` : 'Clear Cache', icon: 'trash', enabled: size > 0 }
  ])
  if (id === 'open') api.reveal(dir)
  else if (id === 'output') api.reveal(output)
  else if (id === 'clear') clearCache()
}

/**
 * Right-click menu for an item (a file, a variant or a composition). Right-clicking outside the selection
 * selects it first.
 */
export async function assetMenu(name: string, path: string, at: { x: number; y: number }, inSingle = false): Promise<void> {
  if (!selection.has(name)) selection.select(name)
  const board = project.board
  const sel = selection.names
  const skip = resolveSettings(board, name).skip
  const composition = items.entry(name)?.kind === 'composition'
  const assets = sel.filter((n) => items.entry(n)?.kind !== 'composition')
  const compositions = items.all.filter((e) => e.kind === 'composition')
  const id = await showMenu(at.x, at.y, [
    ...(inSingle ? [] : [{ id: 'open', label: 'Open', icon: 'open' as const, shortcut: hint(GRID.actions.open) }, { separator: true }]),
    ...(inSingle
      ? []
      : [
          { id: 'duplicate', label: 'Duplicate', icon: 'duplicate' as const, shortcut: hint(GRID.actions.duplicate) },
          { id: 'combine', label: 'Combine into Composition', icon: 'composition' as const, shortcut: hint(GRID.actions.combine), enabled: assets.length > 0 },
          // One per composition, while there are few enough to list.
          ...(assets.length && compositions.length && compositions.length <= 6
            ? compositions.map((g): ContextMenuItem => ({ id: `add:${g.name}`, label: `Add to “${g.label}”`, icon: 'plus' }))
            : []),
          { separator: true }
        ]),
    ...(composition
      ? []
      : [
          { id: 'copy', label: 'Copy Settings', icon: 'copy' as const, shortcut: hint(GLOBAL.actions.copy), enabled: sel.length === 1 },
          {
            id: 'paste',
            label: sel.length > 1 ? `Paste Settings to ${sel.length}` : 'Paste Settings',
            icon: 'paste' as const,
            shortcut: hint(GLOBAL.actions.paste),
            enabled: !!project.clipboard
          },
          {
            id: 'reset',
            label: 'Reset to Defaults',
            icon: 'reset' as const,
            shortcut: hint(GLOBAL.actions.reset),
            enabled: sel.some((n) => hasOverrides(board, n))
          },
          { separator: true }
        ]),
    { id: 'leaveOut', label: 'Leave Out of Export', icon: 'leaveOut', checked: skip },
    { separator: true },
    ...(isVirtual(name) ? [{ id: 'rename', label: 'Rename', icon: 'rename' as const }] : []),
    ...(composition ? [] : [{ id: 'reveal', label: revealLabel, icon: 'reveal' as const }]),
    ...(sel.some(isVirtual) ? [{ id: 'delete', label: 'Delete', icon: 'trash' as const, shortcut: hint(GRID.actions.remove), danger: true }] : [])
  ])
  if (id === 'open') setMode('single')
  else if (id === 'duplicate') duplicateSelection()
  else if (id === 'combine') combineSelection()
  else if (id?.startsWith('add:')) addToComposition(id.slice(4))
  else if (id === 'copy') copy()
  else if (id === 'paste') paste()
  else if (id === 'reset') resetSelection()
  else if (id === 'leaveOut') edit({ skip: !skip })
  else if (id === 'rename') {
    selection.focus = name
    shell.renamingItem = name
  } else if (id === 'delete') deleteSelection()
  else if (id === 'reveal') api.reveal(path)
}

/**
 * Right-click on part of a composition in the single view (on the stage, or in its outline): a cell
 * or a group, selected first; or, on one of several selected, what can be done to them all.
 */
export async function nodeMenu(node: string, comp: Composed, at: { x: number; y: number }): Promise<void> {
  const root = comp.item.root
  const target = findNode(root, node)
  if (!target) return
  const several = selection.nodes.length > 1 && selection.nodes.includes(node)
  if (several) {
    const ids = selection.nodes
    const id = await showMenu(at.x, at.y, [
      { id: 'group', label: 'Group Selection', icon: 'group', shortcut: hint(COMPOSITION_EDITOR.actions.group), enabled: canGroupNodes(ids) },
      { separator: true },
      { id: 'remove', label: `Remove ${ids.length}`, icon: 'trash', shortcut: hint(COMPOSITION_EDITOR.actions.remove), danger: true }
    ])
    if (id === 'group') groupNodes(ids)
    else if (id === 'remove') removeNode(ids)
    return
  }
  selection.node = node
  const group = isSplit(target)
  const layer = group ? undefined : comp.layers.find((l) => l.id === node)
  const filled = !!layer?.source
  const runs = group ? dirsOn(comp.arrangement)(target) : null
  const id = await showMenu(at.x, at.y, [
    ...(group
      ? [
          { id: 'flip', label: runs === 'row' ? 'Make Vertical Stack' : 'Make Horizontal Stack', icon: 'flipDir' as const },
          { id: 'even', label: 'Make Cells Equal', icon: 'evenOut' as const },
          ...(canUngroupNode(node) ? [{ id: 'ungroup', label: 'Ungroup', icon: 'ungroup' as const, shortcut: hint(COMPOSITION_EDITOR.actions.ungroup) }] : [])
        ]
      : [
          { id: 'choose', label: filled ? 'Replace…' : 'Choose…', icon: 'choose' as const },
          ...(filled ? [{ id: 'adjust', label: 'Adjust', icon: 'frameMode' as const, shortcut: hint(COMPOSITION_EDITOR.actions.adjust) }] : [])
        ]),
    { separator: true },
    { id: 'left', label: 'Add Cell to the Left', icon: 'plus' },
    { id: 'right', label: 'Add Cell to the Right', icon: 'plus' },
    { id: 'top', label: 'Add Cell Above', icon: 'plus' },
    { id: 'bottom', label: 'Add Cell Below', icon: 'plus' },
    ...(layer?.source?.kind === 'video'
      ? [{ separator: true }, { id: 'hold', label: 'Hold Last Frame When Shorter', icon: 'pause' as const, checked: layer.end === 'hold' }]
      : []),
    { separator: true },
    ...(parentOf(root, node) ? [{ id: 'parent', label: 'Select Its Group', icon: 'parent' as const, shortcut: hint(COMPOSITION_EDITOR.actions.parent) }] : []),
    { id: 'remove', label: group ? 'Remove Group' : 'Remove Cell', icon: 'trash', shortcut: hint(COMPOSITION_EDITOR.actions.remove), danger: true }
  ])
  if (id === 'choose') shell.choosing = node
  else if (id === 'adjust') shell.adjusting = node
  else if (id === 'flip') flipGroup(node)
  else if (id === 'even') evenOut(node)
  else if (id === 'ungroup') ungroupNode(node)
  else if (id === 'left' || id === 'right' || id === 'top' || id === 'bottom') addCell(node, id)
  else if (id === 'hold') setSlot(node, { end: layer?.end === 'hold' ? 'loop' : 'hold' })
  else if (id === 'parent') selectParent()
  else if (id === 'remove') removeNode(node)
}

/** Right-click menu for an artboard tab. */
export async function boardMenu(boardId: string, at: { x: number; y: number }): Promise<void> {
  const board = project.file.artboards.find((b) => b.id === boardId)
  if (!board) return
  const id = await showMenu(at.x, at.y, [
    { id: 'rename', label: 'Rename', icon: 'rename' },
    { id: 'edit', label: 'Edit Artboard…', icon: 'edit' },
    { id: 'duplicate', label: 'Duplicate', icon: 'duplicate' },
    { separator: true },
    { id: 'delete', label: 'Delete', icon: 'trash', danger: true, enabled: project.file.artboards.length > 1 }
  ])
  if (id === 'rename') shell.renamingBoard = boardId
  else if (id === 'edit') {
    project.boardId = boardId
    shell.editingBoard = boardId
  } else if (id === 'duplicate') duplicateBoard(boardId)
  else if (id === 'delete') deleteBoard(boardId)
}

/** Right-click on a folder's section header in the grid. */
export async function folderMenu(folder: string, at: { x: number; y: number }): Promise<void> {
  if (folder === COMPOSITIONS) {
    const compositions = view.visible.filter((a) => a.kind === 'composition').map((a) => a.name)
    const id = await showMenu(at.x, at.y, [{ id: 'select', label: 'Select All Compositions', icon: 'check', enabled: compositions.length > 0 }])
    if (id === 'select') selection.set(compositions)
    return
  }
  // What's visible in the folder and the folders inside it (selecting hidden assets would let edits
  // land out of sight). A variant is in its file's folder.
  const home = (a: { name: string; source?: string }) => a.source ?? a.name
  const names = view.visible
    .filter((a) => a.kind !== 'composition' && (folderOf(home(a)) === folder || (folder !== '' && home(a).startsWith(folder + '/'))))
    .map((a) => a.name)
  const id = await showMenu(at.x, at.y, [
    { id: 'select', label: 'Select All in Folder', icon: 'check', enabled: names.length > 0 },
    { id: 'reveal', label: revealLabel, icon: 'reveal' },
    ...(folder ? [{ separator: true }, { id: 'exclude', label: 'Exclude from Reframe', icon: 'exclude' as const }] : [])
  ])
  if (id === 'select') selection.set(names)
  else if (id === 'reveal') api.reveal(inside(library.dir!, folder))
  else if (id === 'exclude') excludeFolder(folder)
}

/** Right-click on an excluded folder's bar in the grid. */
export async function excludedFolderMenu(folder: string, at: { x: number; y: number }): Promise<void> {
  const id = await showMenu(at.x, at.y, [
    { id: 'reveal', label: revealLabel, icon: 'reveal' },
    { separator: true },
    { id: 'include', label: 'Include in Reframe', icon: 'show' }
  ])
  if (id === 'include') includeFolder(folder)
  else if (id === 'reveal') api.reveal(inside(library.dir!, folder))
}
