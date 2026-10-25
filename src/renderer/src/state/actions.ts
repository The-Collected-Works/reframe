import { api } from '../lib/bridge'
import { combo, MOD } from '../lib/keys'
import { showToast } from '../ui/toast.svelte'
import { app } from './app.svelte'
import { baseName } from './library'
import { FRAMING_KEYS, hasOverrides } from './project'

/** What the app does that involves more than its own state: the main process, or saying so. */

const undoHint = `${combo(MOD, 'Z')} to undo`

let opening = 0
/**
 * Opens a folder (asking which, without `path`). Not while exporting (the export reads the open
 * folder). Opens can overlap (the launch reopening the last folder while another is picked); only
 * the newest one's result is applied.
 */
export async function openFolder(path?: string): Promise<void> {
  if (app.exportOpen) return
  const n = ++opening
  const scan = await (path ? api.scanFolder(path) : api.openFolder()).catch(() => null)
  if (scan && n === opening) app.load(scan)
}

/**
 * Scans the open folder again and applies the result (the main process runs one scan at a time
 * and hands every caller the newest). Ignored if another folder was opened meanwhile.
 */
export async function rescanFolder(): Promise<void> {
  const scan = await api.rescanFolder().catch(() => null)
  if (scan && scan.dir === app.dir) app.rescan(scan)
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
 * Back to the artboard's framing for every selected asset; undoable, and says so. Whether each is
 * exported stays as it is.
 */
export function resetSelection(): void {
  const names = app.selection.filter((n) => hasOverrides(app.board, n))
  if (!names.length) return
  app.resetKeys(FRAMING_KEYS, names)
  showToast(`Reset ${names.length === 1 ? baseName(names[0]) : `${names.length} assets`} · ${undoHint}`)
}

/** Deletes an artboard, saying how to get it back. */
export function deleteBoard(boardId: string): void {
  const board = app.project.artboards.find((b) => b.id === boardId)
  if (!board) return
  app.removeBoard(boardId)
  showToast(`Deleted “${board.name}” · ${undoHint}`)
}
