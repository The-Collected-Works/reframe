import { DEFAULT_SETTINGS, resolveSettings } from '@shared/layout'
import type { SettingKey } from '@shared/types'
import { combo, MOD, SHIFT } from './keys'
import { api } from './media'
import { baseName, folderOf, hasOverrides, useStore, type AppMenuItem } from './store'

const mac = api.platform === 'darwin'
const revealLabel = mac ? 'Reveal in Finder' : api.platform === 'win32' ? 'Show in Explorer' : 'Show in Folder'
const key = (k: string) => combo(MOD, k)

/** Back to the artboard's defaults for every selected asset; undoable, and says so. */
export function resetSelection(): void {
  const st = useStore.getState()
  const board = st.project.artboards.find((b) => b.id === st.boardId)
  const names = st.selection.filter((n) => board && hasOverrides(board, n))
  if (!names.length) return
  st.resetKeys(Object.keys(DEFAULT_SETTINGS) as SettingKey[], names)
  st.showHud(`Reset ${names.length === 1 ? baseName(names[0]) : `${names.length} assets`} · ${key('Z')} to undo`)
}

let resolver: ((id: string | null) => void) | null = null

/** Opens the app's context menu at a point; resolves with the chosen item's id, or null. */
export function showMenu(x: number, y: number, items: AppMenuItem[]): Promise<string | null> {
  resolver?.(null)
  return new Promise((resolve) => {
    resolver = resolve
    useStore.setState({ contextMenu: { x, y, items } })
  })
}

export function closeMenu(id: string | null): void {
  const r = resolver
  resolver = null
  useStore.setState({ contextMenu: null })
  r?.(id)
}

/** Right-click menu for an asset. Right-clicking outside the selection selects it first. */
export async function assetMenu(name: string, path: string, at: { x: number; y: number }, inLoupe = false): Promise<void> {
  let st = useStore.getState()
  if (!st.selection.includes(name)) st.select(name)
  st = useStore.getState()
  const board = st.project.artboards.find((b) => b.id === st.boardId)!
  const sel = st.selection
  const skip = resolveSettings(board, name).skip
  const id = await showMenu(at.x, at.y, [
    ...(inLoupe ? [] : [{ id: 'open', label: 'Open', icon: 'open' as const, shortcut: 'Space' }, { separator: true }]),
    { id: 'copy', label: 'Copy Settings', icon: 'copy', shortcut: key('C'), enabled: sel.length === 1 },
    {
      id: 'paste',
      label: sel.length > 1 ? `Paste Settings to ${sel.length}` : 'Paste Settings',
      icon: 'paste',
      shortcut: key('V'),
      enabled: !!st.clipboard
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
  st = useStore.getState()
  if (id === 'open') st.setView('loupe')
  else if (id === 'copy') st.copy()
  else if (id === 'paste') st.paste()
  else if (id === 'reset') resetSelection()
  else if (id === 'include') st.edit({ skip: !skip })
  else if (id === 'reveal') api.reveal(path)
}

/** Right-click menu for an artboard tab. */
export async function boardMenu(boardId: string, at: { x: number; y: number }): Promise<void> {
  const st = useStore.getState()
  const board = st.project.artboards.find((b) => b.id === boardId)
  if (!board) return
  const id = await showMenu(at.x, at.y, [
    { id: 'edit', label: 'Edit Artboard…', icon: 'edit' },
    { id: 'duplicate', label: 'Duplicate', icon: 'duplicate' },
    { separator: true },
    { id: 'delete', label: 'Delete', icon: 'trash', danger: true, enabled: st.project.artboards.length > 1 }
  ])
  const s = useStore.getState()
  if (id === 'edit') {
    s.setBoard(boardId)
    s.setBoardEditor(boardId)
  } else if (id === 'duplicate') s.duplicateBoard(boardId)
  else if (id === 'delete') {
    s.removeBoard(boardId)
    s.showHud(`Deleted “${board.name}” · ${key('Z')} to undo`)
  }
}

const sep = api.platform === 'win32' ? '\\' : '/'
const lastPart = (folder: string) => folder.slice(folder.lastIndexOf('/') + 1)

async function rescan(): Promise<void> {
  const scan = await api.rescanFolder()
  if (scan) useStore.getState().rescan(scan)
}

/** Right-click on a folder's section header in the grid. */
export async function folderMenu(folder: string, at: { x: number; y: number }): Promise<void> {
  const st = useStore.getState()
  const names = st.assets.filter((a) => folderOf(a.name) === folder).map((a) => a.name)
  const id = await showMenu(at.x, at.y, [
    { id: 'select', label: 'Select All in Folder', icon: 'check', enabled: names.length > 0 },
    { id: 'reveal', label: revealLabel, icon: 'reveal' },
    ...(folder ? [{ separator: true }, { id: 'exclude', label: 'Exclude from Reframe', icon: 'exclude' as const }] : [])
  ])
  if (id === 'select') useStore.getState().setSelection(names)
  else if (id === 'reveal') api.reveal(folder ? st.dir + sep + folder.split('/').join(sep) : st.dir!)
  else if (id === 'exclude') excludeFolder(folder)
}

/** Leaves a folder (and everything in it) out of the project; its bar stays, dimmed, to bring it back. */
export async function excludeFolder(folder: string): Promise<void> {
  await api.excludeFolder(folder)
  await rescan()
  useStore.getState().showHud(`Excluded “${lastPart(folder)}” · right-click its bar to bring it back`)
}

/** Right-click on an excluded folder's bar in the grid. */
export async function excludedFolderMenu(folder: string, at: { x: number; y: number }): Promise<void> {
  const st = useStore.getState()
  const id = await showMenu(at.x, at.y, [
    { id: 'include', label: 'Include in Reframe', icon: 'show' },
    { id: 'reveal', label: revealLabel, icon: 'reveal' }
  ])
  if (id === 'include') includeFolder(folder)
  else if (id === 'reveal') api.reveal(st.dir + sep + folder.split('/').join(sep))
}

/** Brings an excluded (or export) folder back into the project. */
export async function includeFolder(folder: string): Promise<void> {
  await api.includeFolder(folder)
  await rescan()
  useStore.getState().showHud(`Included “${lastPart(folder)}”`)
}
