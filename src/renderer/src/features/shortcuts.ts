import { library } from '../state/library.svelte'
import { project } from '../state/project.svelte'
import { selection } from '../state/selection.svelte'
import { shell } from '../state/shell.svelte'
import { view } from '../state/view.svelte'
import { clearSelection, copy, openFolder, paste, redo, resetSelection, setMode, undo } from '../state/actions'
import { cancelPick, pickBackground } from './inspector/eyedropper'

/** The app-wide keyboard shortcuts (the single view adds its own: play, zoom). See AppInfo for the list. */
export function onShortcut(e: KeyboardEvent): void {
  const mod = e.metaKey || e.ctrlKey
  const typing = (e.target as HTMLElement).closest('input, textarea, [contenteditable]')
  if (mod && e.key.toLowerCase() === 'o') {
    e.preventDefault()
    return void openFolder()
  }
  if (typing || !library.dir || shell.exportOpen) return
  if (shell.picking) {
    if (e.key === 'Escape') cancelPick()
    return
  }
  const k = e.key.toLowerCase()
  if (mod) {
    if (k === 'z') (e.shiftKey ? redo : undo)()
    else if (k === 'y') redo()
    else if (k === 'a') selection.selectAll()
    else if (k === 'c') copy()
    else if (k === 'v') paste()
    else if (k === 'e') shell.exportOpen = true
    else if (k === 'r' && e.shiftKey) resetSelection()
    else if (/^[1-9]$/.test(k)) {
      const b = project.file.artboards[Number(k) - 1]
      if (b) project.boardId = b.id
    } else return
    e.preventDefault()
    return
  }
  if (shell.editingBoard) return
  if (k === 'i') pickBackground()
  else if (k === 'escape') {
    if (view.mode === 'single') setMode('grid')
    else clearSelection()
  } else if (k === 'e') setMode(view.mode === 'single' ? 'grid' : 'single')
  // Space opens the selection, like Quick Look; in single view it plays and pauses instead. A
  // focused button keeps Space for itself.
  else if (k === ' ' && view.mode === 'grid' && selection.focus && !(e.target as HTMLElement).closest('button')) setMode('single')
  else if (k === 'arrowright' || (k === 'arrowdown' && view.mode === 'single')) selection.step(1)
  else if (k === 'arrowleft' || (k === 'arrowup' && view.mode === 'single')) selection.step(-1)
  else if (k === 'arrowdown' || k === 'arrowup') stepRow(k === 'arrowdown' ? 1 : -1)
  else return
  e.preventDefault()
}

/**
 * Up / down in the grid: to the nearest thumbnail in the next row that way, by position on screen,
 * so folder headers and short last rows don't throw it off.
 */
function stepRow(dir: 1 | -1): void {
  const cur = document.querySelector<HTMLElement>('.grid .cell.focused')
  if (!cur) return selection.step(dir)
  const r = cur.getBoundingClientRect()
  const cx = r.left + r.width / 2
  let best: { name: string; dy: number; dx: number } | null = null
  for (const c of document.querySelectorAll<HTMLElement>('.grid .cell')) {
    const q = c.getBoundingClientRect()
    const dy = (q.top - r.top) * dir
    if (dy < 2) continue
    const dx = Math.abs(q.left + q.width / 2 - cx)
    if (!best || dy < best.dy - 2 || (Math.abs(dy - best.dy) <= 2 && dx < best.dx)) best = { name: c.dataset.name!, dy, dx }
  }
  if (best) selection.select(best.name)
}
