import { useCallback, useEffect, useRef, useState } from 'react'
import { ContextMenu } from './components/ContextMenu'
import { ExportDialog } from './components/ExportDialog'
import { Grid } from './components/Grid'
import { Inspector } from './components/Inspector'
import { Loupe } from './components/Loupe'
import { TopBar } from './components/TopBar'
import { Icon } from './components/ui'
import { resetSelection } from './menus'
import { api, cancelPick, pickBackground, rescanFolder } from './media'
import { usePresence } from './motion'
import { basename } from './paths'
import type { ProjectFile } from '@shared/types'
import { useStore } from './store'

function Hud() {
  const hud = useStore((s) => s.hud)
  return hud ? (
    <div key={hud.n} className="hud" role="status">
      {hud.text}
    </div>
  ) : null
}

export function App() {
  const dir = useStore((s) => s.dir)
  const view = useStore((s) => s.view)
  const empty = useStore((s) => s.assets.length === 0)
  const exportOpen = useStore((s) => s.exportOpen)
  const exportPresence = usePresence(exportOpen, 180)
  const [dropping, setDropping] = useState(false)
  // The window controls are drawn by the OS over the page, so CSS can't dim them with the
  // dialog's backdrop; the main process matches them instead.
  useEffect(() => {
    api.setOverlayTint(exportOpen ? 'dim' : 'none')
  }, [exportOpen])
  const [booted, setBooted] = useState(false)

  // Not while exporting (the export reads the open folder). Opens can overlap (the launch reopening
  // the last folder while another is picked); only the newest one's result is applied.
  const opening = useRef(0)
  const openDir = useCallback(async (path?: string) => {
    if (useStore.getState().exportOpen) return
    const n = ++opening.current
    const scan = await (path ? api.scanFolder(path) : api.openFolder()).catch(() => null)
    if (scan && n === opening.current) useStore.getState().load(scan)
  }, [])

  // A folder picked from the taskbar's or Dock's recent folders while the app is running.
  useEffect(() => api.onOpenFolderRequest((dir) => openDir(dir)), [openDir])

  // Reopen the last folder on launch.
  useEffect(() => {
    api.lastFolder().then(async (d) => {
      if (d) await openDir(d)
      setBooted(true)
    })
  }, [openDir])

  // Pick up files added to or removed from the folder.
  useEffect(() => api.onFolderChanged(rescanFolder), [])

  // Autosave the project next to the assets, shortly after edits settle. A save still waiting is
  // written straight away when another folder is opened or the window closes.
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined
    let waiting: { dir: string; project: ProjectFile } | null = null
    const flush = () => {
      clearTimeout(t)
      if (waiting) api.saveProject(waiting.dir, waiting.project).catch(() => {})
      waiting = null
    }
    const unsub = useStore.subscribe((s, prev) => {
      if (s.dir !== prev.dir) return flush()
      if (s.project === prev.project || !s.dir) return
      waiting = { dir: s.dir, project: s.project }
      clearTimeout(t)
      t = setTimeout(flush, 400)
    })
    window.addEventListener('pagehide', flush)
    return () => {
      flush()
      unsub()
      window.removeEventListener('pagehide', flush)
    }
  }, [])

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const st = useStore.getState()
      const mod = e.metaKey || e.ctrlKey
      const typing = (e.target as HTMLElement).closest('input, textarea, [contenteditable]')
      if (mod && e.key.toLowerCase() === 'o') {
        e.preventDefault()
        return openDir()
      }
      if (typing || !st.dir || st.exportOpen) return
      if (st.picking) {
        if (e.key === 'Escape') cancelPick()
        return
      }
      const k = e.key.toLowerCase()
      if (mod) {
        if (k === 'z') st[e.shiftKey ? 'redo' : 'undo']()
        else if (k === 'y') st.redo()
        else if (k === 'a') st.selectAll()
        else if (k === 'c') st.copy()
        else if (k === 'v') st.paste()
        else if (k === 'e') st.setExportOpen(true)
        else if (k === 'r' && e.shiftKey) resetSelection()
        else if (/^[1-9]$/.test(k)) {
          const b = st.project.artboards[Number(k) - 1]
          if (b) st.setBoard(b.id)
        } else return
        e.preventDefault()
        return
      }
      if (st.boardEditor) return
      if (k === 'i') pickBackground()
      else if (k === 'escape') {
        if (st.view === 'loupe') st.setView('grid')
        else st.clearSelection()
      } else if (k === 'e') st.setView(st.view === 'loupe' ? 'grid' : 'loupe')
      // Space opens the selection, like Quick Look; in single view it plays and pauses instead.
      // A focused button keeps Space for itself.
      else if (k === ' ' && st.view === 'grid' && st.focus && !(e.target as HTMLElement).closest('button')) st.setView('loupe')
      else if (k === 'arrowright' || (k === 'arrowdown' && st.view === 'loupe')) st.step(1)
      else if (k === 'arrowleft' || (k === 'arrowup' && st.view === 'loupe')) st.step(-1)
      else if (k === 'arrowdown' || k === 'arrowup') stepRow(k === 'arrowdown' ? 1 : -1)
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [openDir])

  // Focus rings only while navigating with Tab, as in native apps; any pointer use hides them.
  // (Otherwise a clicked button shows a ring as soon as an arrow key is pressed.)
  useEffect(() => {
    const root = document.documentElement
    const key = (e: KeyboardEvent) => e.key === 'Tab' && root.classList.add('keyboard-nav')
    const pointer = () => root.classList.remove('keyboard-nav')
    window.addEventListener('keydown', key, true)
    window.addEventListener('pointerdown', pointer, true)
    return () => {
      window.removeEventListener('keydown', key, true)
      window.removeEventListener('pointerdown', pointer, true)
    }
  }, [])

  // The folder in the window title (taskbar, Mission Control, window menus).
  useEffect(() => {
    document.title = dir ? `${basename(dir)} — Reframe` : 'Reframe'
  }, [dir])

  // Keep the focused cell in view when navigating by keyboard.
  const focus = useStore((s) => s.focus)
  useEffect(() => {
    if (view !== 'grid' || !focus) return
    document.querySelector('.cell.focused')?.scrollIntoView({ block: 'nearest' })
  }, [focus, view])

  // The drop tint goes when the drag leaves for anywhere outside the app (including off the
  // window, where nothing is the related target). As a backstop, dragover repeats every ~50ms
  // while files are over the window, so if it stops the drag has gone, however it ended.
  const dropIdle = useRef<ReturnType<typeof setTimeout>>(undefined)
  const endDrop = () => {
    clearTimeout(dropIdle.current)
    setDropping(false)
  }
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    endDrop()
    const file = e.dataTransfer.files[0]
    if (file) openDir(api.pathForFile(file))
  }
  // The viewport (or the empty state) is the drop zone, and only it tints: the top bar sits under
  // the OS-drawn window controls, which couldn't follow the tint in step.
  const dropZone = {
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
      setDropping(true)
      clearTimeout(dropIdle.current)
      dropIdle.current = setTimeout(endDrop, 250)
    },
    onDragLeave: (e: React.DragEvent) => !e.currentTarget.contains(e.relatedTarget as Node | null) && endDrop(),
    onDrop
  }
  const zone = (name: string) => name + ' drop-zone' + (dropping ? ' dropping' : '')
  // Elsewhere, files are refused (a not-allowed cursor) rather than opened by the browser, which
  // would navigate the window away from the app.
  useEffect(() => {
    const refuse = (e: DragEvent) => {
      if (e.defaultPrevented) return
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'none'
    }
    window.addEventListener('dragover', refuse)
    window.addEventListener('drop', refuse)
    return () => {
      window.removeEventListener('dragover', refuse)
      window.removeEventListener('drop', refuse)
    }
  }, [])

  return (
    <div className="app">
      <TopBar onOpen={openDir} />
      {dir ? (
        <main className="workspace">
          <section className={zone('content')} {...dropZone}>
            <Grid active={view === 'grid'} />
            {view === 'loupe' && <Loupe />}
          </section>
          <Inspector />
        </main>
      ) : (
        booted && (
          <main className={zone('empty')} {...dropZone}>
            <button className="empty-drop" onClick={() => openDir()}>
              <Icon name="folder" size={28} />
              <span>Open a folder</span>
              <span className="muted small">or drop one here</span>
            </button>
          </main>
        )
      )}
      {dir && empty && <div className="empty-hint center">No images or videos in this folder</div>}
      {exportPresence.mounted && <ExportDialog closing={exportPresence.closing} />}
      <Hud />
      <ContextMenu />
    </div>
  )
}

/**
 * Up / down in the grid: to the nearest thumbnail in the next row that way, by position on screen,
 * so folder headers and short last rows don't throw it off.
 */
function stepRow(dir: 1 | -1): void {
  const st = useStore.getState()
  const cur = document.querySelector<HTMLElement>('.grid .cell.focused')
  if (!cur) return st.step(dir)
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
  if (best) st.select(best.name)
}
