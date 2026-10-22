import { useCallback, useEffect, useState } from 'react'
import { ExportDialog } from './components/ExportDialog'
import { Grid } from './components/Grid'
import { Inspector } from './components/Inspector'
import { Loupe } from './components/Loupe'
import { TopBar } from './components/TopBar'
import { Icon } from './components/ui'
import { api, cancelPick, hydrate, pickBackground } from './media'
import { useStore } from './store'

export function App() {
  const dir = useStore((s) => s.dir)
  const view = useStore((s) => s.view)
  const assets = useStore((s) => s.assets)
  const exportOpen = useStore((s) => s.exportOpen)
  const [dropping, setDropping] = useState(false)
  const [booted, setBooted] = useState(false)

  const openDir = useCallback(async (path?: string) => {
    const scan = path ? await api.scanFolder(path).catch(() => null) : await api.openFolder()
    if (scan) useStore.getState().load(scan)
  }, [])

  // Reopen the last folder on launch.
  useEffect(() => {
    api.lastFolder().then(async (d) => {
      if (d) await openDir(d)
      setBooted(true)
    })
  }, [openDir])

  useEffect(() => hydrate(assets), [assets])

  // Pick up files added to or removed from the folder.
  useEffect(
    () =>
      api.onFolderChanged(async () => {
        const d = useStore.getState().dir
        if (d) useStore.getState().rescan(await api.scanFolder(d))
      }),
    []
  )

  // Autosave the project next to the assets.
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined
    const unsub = useStore.subscribe((s, prev) => {
      if (s.project === prev.project || !s.dir || s.dir !== prev.dir) return
      clearTimeout(t)
      const { dir, project } = s
      t = setTimeout(() => api.saveProject(dir, project).catch(() => {}), 400)
    })
    return () => {
      unsub()
      clearTimeout(t)
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
      } else if (k === 'g') st.setView('grid')
      else if (k === 'e' || (k === 'enter' && st.view === 'grid')) st.setView('loupe')
      else if (k === 'arrowright' || (k === 'arrowdown' && st.view === 'loupe')) st.step(1)
      else if (k === 'arrowleft' || (k === 'arrowup' && st.view === 'loupe')) st.step(-1)
      else if (k === 'arrowdown' || k === 'arrowup') {
        const cols = Math.round(document.querySelector('.grid')!.clientWidth / (document.querySelector('.cell')?.clientWidth ?? 1))
        st.step(k === 'arrowdown' ? cols : -cols)
      } else return
      e.preventDefault()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [openDir])

  // Keep the focused cell in view when navigating by keyboard.
  const focus = useStore((s) => s.focus)
  useEffect(() => {
    if (view !== 'grid' || !focus) return
    document.querySelector('.cell.focused')?.scrollIntoView({ block: 'nearest' })
  }, [focus, view])

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDropping(false)
    const file = e.dataTransfer.files[0]
    if (file) openDir(api.pathForFile(file))
  }

  return (
    <div
      className={'app' + (dropping ? ' dropping' : '')}
      onDragOver={(e) => {
        e.preventDefault()
        setDropping(true)
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDropping(false)}
      onDrop={onDrop}
    >
      <TopBar onOpen={() => openDir()} />
      {dir ? (
        <main className="workspace">
          <section className="content">
            <Grid active={view === 'grid'} />
            {view === 'loupe' && <Loupe />}
          </section>
          <Inspector />
        </main>
      ) : (
        booted && (
          <main className="empty">
            <button className="empty-drop" onClick={() => openDir()}>
              <Icon name="folder" size={28} />
              <span>Open a folder</span>
              <span className="muted small">or drop one here</span>
            </button>
          </main>
        )
      )}
      {dir && assets.length === 0 && <div className="empty-hint center">No images or videos in this folder</div>}
      {exportOpen && <ExportDialog />}
    </div>
  )
}
