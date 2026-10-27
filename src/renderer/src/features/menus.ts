import type { Dir } from '@shared/composition/bento'
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
  removeSlot,
  resetSelection,
  setMode,
  setSlot,
  splitSlot
} from '../state/actions'
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

/** The right-click menus: on items (grid and single view), composition cells, artboard tabs, and folder headers. */

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

/** Right-click on a composition's cell in the single view (it's selected first). */
export async function slotMenu(slot: string, filled: boolean, video: boolean, end: 'loop' | 'hold', at: { x: number; y: number }): Promise<void> {
  selection.slot = slot
  const id = await showMenu(at.x, at.y, [
    { id: 'choose', label: filled ? 'Replace…' : 'Choose…', icon: 'replace' },
    { separator: true },
    { id: 'row', label: 'Add Cell Beside', icon: 'splitRow' },
    { id: 'col', label: 'Add Cell Below', icon: 'splitCol' },
    ...(video ? [{ separator: true }, { id: 'hold', label: 'Hold Last Frame When Shorter', icon: 'pause' as const, checked: end === 'hold' }] : []),
    { separator: true },
    { id: 'remove', label: 'Remove Cell', icon: 'trash', shortcut: hint(COMPOSITION_EDITOR.actions.remove), danger: true }
  ])
  if (id === 'choose') shell.choosing = slot
  else if (id === 'row' || id === 'col') splitSlot(id as Dir)
  else if (id === 'hold') setSlot(slot, { end: end === 'hold' ? 'loop' : 'hold' })
  else if (id === 'remove') removeSlot()
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
