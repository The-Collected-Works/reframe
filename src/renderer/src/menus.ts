import { DEFAULT_SETTINGS, resolveSettings } from '@shared/layout'
import type { SettingKey } from '@shared/types'
import { api } from './media'
import { hasOverrides, useStore, type AppMenuItem } from './store'

const mac = api.platform === 'darwin'
const revealLabel = mac ? 'Reveal in Finder' : api.platform === 'win32' ? 'Show in Explorer' : 'Show in Folder'
const key = (k: string) => (mac ? `⌘${k}` : `Ctrl+${k}`)

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
    ...(inLoupe ? [] : [{ id: 'open', label: 'Open', icon: 'open' as const, shortcut: 'E' }, { separator: true }]),
    { id: 'copy', label: 'Copy Settings', icon: 'copy', shortcut: key('C'), enabled: sel.length === 1 },
    {
      id: 'paste',
      label: sel.length > 1 ? `Paste Settings to ${sel.length}` : 'Paste Settings',
      icon: 'paste',
      shortcut: key('V'),
      enabled: !!st.clipboard
    },
    { id: 'reset', label: 'Reset to Defaults', icon: 'reset', enabled: sel.some((n) => hasOverrides(board, n)) },
    { separator: true },
    { id: 'include', label: 'Include in Export', icon: 'include', checked: !skip },
    { separator: true },
    { id: 'reveal', label: revealLabel, icon: 'reveal' }
  ])
  st = useStore.getState()
  if (id === 'open') st.setView('loupe')
  else if (id === 'copy') st.copy()
  else if (id === 'paste') st.paste()
  else if (id === 'reset') st.resetKeys(Object.keys(DEFAULT_SETTINGS) as SettingKey[])
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
