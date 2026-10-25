import { resolveSettings } from '@shared/layout'
import { combo, MOD, SHIFT } from '../lib/keys'
import { api, rescanFolder } from '../state/loading'
import { inside, mac } from '../lib/paths'
import { app, baseName, folderOf, FRAMING_KEYS, hasOverrides, type AppMenuItem } from '../state/app.svelte'

const revealLabel = mac ? 'Reveal in Finder' : api.platform === 'win32' ? 'Show in Explorer' : 'Show in Folder'
const key = (k: string) => combo(MOD, k)

/**
 * Back to the artboard's framing for every selected asset; undoable, and says so. Whether each is
 * exported stays as it is.
 */
export function resetSelection(): void {
  const board = app.board
  const names = app.selection.filter((n) => hasOverrides(board, n))
  if (!names.length) return
  app.resetKeys(FRAMING_KEYS, names)
  app.showHud(`Reset ${names.length === 1 ? baseName(names[0]) : `${names.length} assets`} · ${key('Z')} to undo`)
}

let resolver: ((id: string | null) => void) | null = null

/** Opens the app's context menu at a point; resolves with the chosen item's id, or null. */
export function showMenu(x: number, y: number, items: AppMenuItem[]): Promise<string | null> {
  resolver?.(null)
  return new Promise((resolve) => {
    resolver = resolve
    app.contextMenu = { x, y, items }
  })
}

export function closeMenu(id: string | null): void {
  const r = resolver
  resolver = null
  app.contextMenu = null
  r?.(id)
}

/** Right-click menu for an asset. Right-clicking outside the selection selects it first. */
export async function assetMenu(name: string, path: string, at: { x: number; y: number }, inSingle = false): Promise<void> {
  if (!app.selected.has(name)) app.select(name)
  const board = app.board
  const sel = app.selection
  const skip = resolveSettings(board, name).skip
  const id = await showMenu(at.x, at.y, [
    ...(inSingle ? [] : [{ id: 'open', label: 'Open', icon: 'open' as const, shortcut: 'Space' }, { separator: true }]),
    { id: 'copy', label: 'Copy Settings', icon: 'copy', shortcut: key('C'), enabled: sel.length === 1 },
    {
      id: 'paste',
      label: sel.length > 1 ? `Paste Settings to ${sel.length}` : 'Paste Settings',
      icon: 'paste',
      shortcut: key('V'),
      enabled: !!app.clipboard
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
  if (id === 'open') app.setView('single')
  else if (id === 'copy') app.copy()
  else if (id === 'paste') app.paste()
  else if (id === 'reset') resetSelection()
  else if (id === 'include') app.edit({ skip: !skip })
  else if (id === 'reveal') api.reveal(path)
}

/** Right-click menu for an artboard tab. */
export async function boardMenu(boardId: string, at: { x: number; y: number }): Promise<void> {
  const board = app.project.artboards.find((b) => b.id === boardId)
  if (!board) return
  const id = await showMenu(at.x, at.y, [
    { id: 'edit', label: 'Edit Artboard…', icon: 'edit' },
    { id: 'duplicate', label: 'Duplicate', icon: 'duplicate' },
    { separator: true },
    { id: 'delete', label: 'Delete', icon: 'trash', danger: true, enabled: app.project.artboards.length > 1 }
  ])
  if (id === 'edit') {
    app.setBoard(boardId)
    app.setBoardEditor(boardId)
  } else if (id === 'duplicate') app.duplicateBoard(boardId)
  else if (id === 'delete') deleteBoard(boardId)
}

/** Deletes an artboard, saying how to get it back. */
export function deleteBoard(boardId: string): void {
  const board = app.project.artboards.find((b) => b.id === boardId)
  if (!board) return
  app.removeBoard(boardId)
  app.showHud(`Deleted “${board.name}” · ${key('Z')} to undo`)
}

/** Right-click on a folder's section header in the grid. */
export async function folderMenu(folder: string, at: { x: number; y: number }): Promise<void> {
  // What's visible in the folder and the folders inside it (selecting hidden assets would let edits
  // land out of sight).
  const names = app.visible
    .filter((a) => folderOf(a.name) === folder || (folder !== '' && a.name.startsWith(folder + '/')))
    .map((a) => a.name)
  const id = await showMenu(at.x, at.y, [
    { id: 'select', label: 'Select All in Folder', icon: 'check', enabled: names.length > 0 },
    { id: 'reveal', label: revealLabel, icon: 'reveal' },
    ...(folder ? [{ separator: true }, { id: 'exclude', label: 'Exclude from Reframe', icon: 'exclude' as const }] : [])
  ])
  if (id === 'select') app.setSelection(names)
  else if (id === 'reveal') api.reveal(inside(app.dir!, folder))
  else if (id === 'exclude') excludeFolder(folder)
}

/** Leaves a folder (and everything in it) out of the project; its bar stays, dimmed, to bring it back. */
export async function excludeFolder(folder: string): Promise<void> {
  await api.excludeFolder(folder)
  await rescanFolder()
  app.showHud(`Excluded “${baseName(folder)}” · right-click its bar to bring it back`)
}

/** Right-click on an excluded folder's bar in the grid. */
export async function excludedFolderMenu(folder: string, at: { x: number; y: number }): Promise<void> {
  const id = await showMenu(at.x, at.y, [
    { id: 'reveal', label: revealLabel, icon: 'reveal' },
    { separator: true },
    { id: 'include', label: 'Include in Reframe', icon: 'show' }
  ])
  if (id === 'include') includeFolder(folder)
  else if (id === 'reveal') api.reveal(inside(app.dir!, folder))
}

/** Brings an excluded (or export) folder back into the project. */
export async function includeFolder(folder: string): Promise<void> {
  await api.includeFolder(folder)
  await rescanFolder()
  app.showHud(`Included “${baseName(folder)}”`)
}
