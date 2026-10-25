import { resolveSettings } from '@shared/layout'
import { api, mac, win } from '../lib/bridge'
import { combo, MOD, SHIFT } from '../lib/keys'
import { inside } from '../lib/paths'
import { copy, deleteBoard, duplicateBoard, edit, excludeFolder, includeFolder, paste, resetSelection, setMode } from '../state/actions'
import { library } from '../state/library.svelte'
import { hasOverrides } from '../state/model/project'
import { folderOf } from '../state/model/tree'
import { project } from '../state/project.svelte'
import { selection } from '../state/selection.svelte'
import { shell } from '../state/shell.svelte'
import { view } from '../state/view.svelte'
import { showMenu } from '../ui'

/** The right-click menus: on assets (grid and single view), artboard tabs, and folder headers. */

const revealLabel = mac ? 'Reveal in Finder' : win ? 'Show in Explorer' : 'Show in Folder'
const key = (k: string) => combo(MOD, k)

/** Right-click menu for an asset. Right-clicking outside the selection selects it first. */
export async function assetMenu(name: string, path: string, at: { x: number; y: number }, inSingle = false): Promise<void> {
  if (!selection.has(name)) selection.select(name)
  const board = project.board
  const sel = selection.names
  const skip = resolveSettings(board, name).skip
  const id = await showMenu(at.x, at.y, [
    ...(inSingle ? [] : [{ id: 'open', label: 'Open', icon: 'open' as const, shortcut: 'Space' }, { separator: true }]),
    { id: 'copy', label: 'Copy Settings', icon: 'copy', shortcut: key('C'), enabled: sel.length === 1 },
    {
      id: 'paste',
      label: sel.length > 1 ? `Paste Settings to ${sel.length}` : 'Paste Settings',
      icon: 'paste',
      shortcut: key('V'),
      enabled: !!project.clipboard
    },
    {
      id: 'reset',
      label: 'Reset to Defaults',
      icon: 'reset',
      shortcut: combo(MOD, SHIFT, 'R'),
      enabled: sel.some((n) => hasOverrides(board, n))
    },
    { separator: true },
    { id: 'include', label: 'Include in Export', icon: 'include', checked: !skip },
    { separator: true },
    { id: 'reveal', label: revealLabel, icon: 'reveal' }
  ])
  if (id === 'open') setMode('single')
  else if (id === 'copy') copy()
  else if (id === 'paste') paste()
  else if (id === 'reset') resetSelection()
  else if (id === 'include') edit({ skip: !skip })
  else if (id === 'reveal') api.reveal(path)
}

/** Right-click menu for an artboard tab. */
export async function boardMenu(boardId: string, at: { x: number; y: number }): Promise<void> {
  const board = project.file.artboards.find((b) => b.id === boardId)
  if (!board) return
  const id = await showMenu(at.x, at.y, [
    { id: 'edit', label: 'Edit Artboard…', icon: 'edit' },
    { id: 'duplicate', label: 'Duplicate', icon: 'duplicate' },
    { separator: true },
    { id: 'delete', label: 'Delete', icon: 'trash', danger: true, enabled: project.file.artboards.length > 1 }
  ])
  if (id === 'edit') {
    project.boardId = boardId
    shell.editingBoard = boardId
  } else if (id === 'duplicate') duplicateBoard(boardId)
  else if (id === 'delete') deleteBoard(boardId)
}

/** Right-click on a folder's section header in the grid. */
export async function folderMenu(folder: string, at: { x: number; y: number }): Promise<void> {
  // What's visible in the folder and the folders inside it (selecting hidden assets would let edits
  // land out of sight).
  const names = view.visible.filter((a) => folderOf(a.name) === folder || (folder !== '' && a.name.startsWith(folder + '/'))).map((a) => a.name)
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
