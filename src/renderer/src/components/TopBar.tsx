import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Artboard, ReleaseNote } from '@shared/types'
import { api } from '../media'
import { boardMenu } from '../menus'
import { reducedMotion } from '../motion'
import { PRESETS, useStore } from '../store'
import { Icon, NumberField, Popover, Segmented } from './ui'

const basename = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p

export function TopBar({ onOpen }: { onOpen: () => void }) {
  const dir = useStore((s) => s.dir)
  const boards = useStore((s) => s.project.artboards)
  const boardId = useStore((s) => s.boardId)
  const view = useStore((s) => s.view)
  const cellSize = useStore((s) => s.cellSize)
  const editor = useStore((s) => s.boardEditor)
  const { setBoard, setView, setCellSize, setExportOpen, setBoardEditor, addBoard } = useStore.getState()
  const [adding, setAdding] = useState(false)
  const update = useUpdateCheck()

  return (
    <header className={'topbar ' + api.platform}>
      <button className="folder" onClick={onOpen} title={dir ?? 'Open folder'}>
        <Icon name="folder" size={15} />
        <span>{dir ? basename(dir) : 'Open folder'}</span>
      </button>

      {dir && (
        <div className="tabs-wrap">
          <TabStrip>
            {boards.map((b, i) => (
              <div key={b.id} className="tab-wrap">
                <button
                  className={'tab' + (b.id === boardId ? ' on' : '') + (editor === b.id ? ' editing' : '')}
                  title={b.id === boardId ? 'Edit artboard' : i < 9 ? `${api.platform === 'darwin' ? '⌘' : 'Ctrl+'}${i + 1}` : undefined}
                  onClick={() => (b.id === boardId ? setBoardEditor(editor === b.id ? null : b.id) : setBoard(b.id))}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    boardMenu(b.id, { x: e.clientX, y: e.clientY })
                  }}
                >
                  <span>{b.name}</span>
                  <span className="dims">
                    {b.width}×{b.height}
                  </span>
                  {/* The active tab opens its editor; the chevron says so. Every tab reserves its
                      space, so switching tabs doesn't change any widths. */}
                  <span className="tab-chevron" aria-hidden>
                    <Icon name="chevronDown" size={12} />
                  </span>
                </button>
                <BoardEditor board={b} open={editor === b.id} canDelete={boards.length > 1} />
              </div>
            ))}
          </TabStrip>
          <div className="tab-wrap">
            <button className="icon-btn" title="Add artboard" onClick={() => setAdding(!adding)}>
              <Icon name="plus" size={14} />
            </button>
            <Popover open={adding} onClose={() => setAdding(false)} className="menu">
              {PRESETS.map((p) => (
                <button
                  key={p.name}
                  className="menu-item"
                  onClick={() => {
                    addBoard(p.name, p.width, p.height)
                    setAdding(false)
                  }}
                >
                  <span>{p.name}</span>
                  <span className="muted">
                    {p.width}×{p.height}
                  </span>
                </button>
              ))}
              <div className="menu-sep" />
              <button
                className="menu-item"
                onClick={() => {
                  addBoard('Custom', 1200, 1200)
                  setAdding(false)
                  setBoardEditor(useStore.getState().boardId)
                }}
              >
                Custom…
              </button>
            </Popover>
          </div>
        </div>
      )}

      <div className="drag-fill" />

      {update && <UpdateButton update={update} />}

      {dir && (
        <div className="tools">
          {view === 'grid' && (
            <input
              type="range"
              className="slider size"
              min={120}
              max={480}
              value={cellSize}
              style={{ ['--p' as string]: `${((cellSize - 120) / 360) * 100}%` }}
              onChange={(e) => setCellSize(Number(e.target.value))}
              title="Thumbnail size"
            />
          )}
          <Segmented
            value={view}
            options={[
              { value: 'grid', label: <Icon name="grid" size={15} />, title: 'Grid (G)' },
              { value: 'loupe', label: <Icon name="loupe" size={15} />, title: 'Single (E)' }
            ]}
            onChange={setView}
          />
          <button className="primary" onClick={() => setExportOpen(true)} title={`Export (${api.platform === 'darwin' ? '⌘' : 'Ctrl+'}E)`}>
            <Icon name="export" size={14} />
            Export
          </button>
        </div>
      )}
    </header>
  )
}

type Update = { version: string; notes: ReleaseNote[] }

/** Checks for a newer release shortly after launch and every few hours; null until there is one. */
function useUpdateCheck(): Update | null {
  const [version, setVersion] = useState<Update | null>(null)
  useEffect(() => {
    const check = () => api.checkUpdate().then((u) => setVersion(u ?? null), () => {})
    const first = setTimeout(check, 3000)
    const every = setInterval(check, 6 * 60 * 60 * 1000)
    return () => {
      clearTimeout(first)
      clearInterval(every)
    }
  }, [])
  return version
}

/**
 * Opens the release page on click. Hovering reveals what's new: the notes of every release since
 * this build, newest first. The dropdown stays open while the pointer moves between the two.
 */
function UpdateButton({ update }: { update: Update }) {
  const [open, setOpen] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const later = (fn: () => void, ms: number) => {
    clearTimeout(timer.current)
    timer.current = setTimeout(fn, ms)
  }
  const enter = () => later(() => setOpen(true), open ? 0 : 180)
  const leave = () => later(() => setOpen(false), 220)
  useEffect(() => () => clearTimeout(timer.current), [])
  return (
    <div className="update-wrap" onPointerEnter={enter} onPointerLeave={leave}>
      <button className="update" title={open ? undefined : `Reframe ${update.version} is available`} onClick={() => api.openRelease()}>
        <Icon name="update" size={14} />
        Update
        <span className="muted">{update.version}</span>
      </button>
      <Popover open={open && update.notes.length > 0} onClose={() => setOpen(false)} className="changelog">
        <div className="changelog-body" onPointerEnter={() => clearTimeout(timer.current)} onPointerLeave={leave}>
          <div className="changelog-scroll">
            {update.notes.map((n) => (
              <section key={n.version} className="release">
                <header>
                  <span className="release-version">{n.version}</span>
                  {n.date && <span className="muted">{fmtDate(n.date)}</span>}
                </header>
                {n.body.trim() ? <Notes text={n.body} /> : <p className="muted">No notes for this release.</p>}
              </section>
            ))}
          </div>
          <div className="menu-sep" />
          <button className="ghost changelog-download" onClick={() => api.openRelease()}>
            <Icon name="download" size={14} />
            Download {update.version}
          </button>
        </div>
      </Popover>
    </div>
  )
}

const fmtDate = (iso: string) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

/**
 * Release notes, from GitHub Markdown: headings, bullet and numbered lists, paragraphs, bold and
 * inline code. Built as React elements (never HTML), so whatever the notes contain is just text;
 * links show their text, and raw HTML tags are dropped.
 */
function Notes({ text }: { text: string }) {
  const blocks: React.ReactNode[] = []
  let list: string[] = []
  let para: string[] = []
  const flush = () => {
    if (para.length) blocks.push(<p key={blocks.length}>{inline(para.join(' '))}</p>)
    if (list.length)
      blocks.push(
        <ul key={blocks.length}>
          {list.map((item, i) => (
            <li key={i}>{inline(item)}</li>
          ))}
        </ul>
      )
    para = []
    list = []
  }
  for (const raw of text.replace(/<[^>]*>/g, '').split(/\r?\n/)) {
    const line = raw.trim()
    const heading = /^#{1,6}\s+(.*)$/.exec(line)
    const item = /^(?:[-*+]|\d+[.)])\s+(.*)$/.exec(line)
    if (!line) flush()
    else if (heading) {
      flush()
      blocks.push(<h4 key={blocks.length}>{inline(heading[1])}</h4>)
    } else if (item) {
      if (para.length) flush()
      list.push(item[1])
    } else if (list.length) list[list.length - 1] += ' ' + line
    else para.push(line)
  }
  flush()
  return <div className="notes">{blocks}</div>
}

/** **bold**, `code` and [text](url) → text. GitHub links shrink to "#12" or "v0.1.0…v0.2.0". */
function inline(raw: string): React.ReactNode[] {
  const text = raw
    .replace(/https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/(?:pull|issues)\/(\d+)/g, '#$1')
    .replace(/https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/compare\/(\S+?)\.\.\.(\S+)/g, '$1…$2')
  const out: React.ReactNode[] = []
  const re = /\*\*(.+?)\*\*|`([^`]+)`|\[([^\]]+)\]\([^)]*\)/g
  let last = 0
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push(text.slice(last, m.index))
    if (m[1] != null) out.push(<strong key={m.index}>{m[1]}</strong>)
    else if (m[2] != null) out.push(<code key={m.index}>{m[2]}</code>)
    else out.push(m[3])
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

/**
 * The artboard tabs when they overflow: fades on whichever side has more, the wheel scrolls them
 * sideways, and click-dragging pans (a click that doesn't move still selects a tab). The active
 * tab is kept in view when it changes.
 */
function TabStrip({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLElement>(null)
  const boardId = useStore((s) => s.boardId)
  const boards = useStore((s) => s.project.artboards)
  const [fade, setFade] = useState({ left: false, right: false })

  useLayoutEffect(() => {
    const el = ref.current!
    // Compares the outermost tabs with the strip's edges rather than scroll arithmetic, which
    // can be off by a fraction of a pixel at fractional display scaling.
    const update = () => {
      const tabs = el.querySelectorAll('.tab-wrap')
      if (!tabs.length) return setFade({ left: false, right: false })
      const strip = el.getBoundingClientRect()
      setFade({
        left: tabs[0].getBoundingClientRect().left < strip.left - 1,
        right: tabs[tabs.length - 1].getBoundingClientRect().right > strip.right + 1
      })
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    el.addEventListener('scroll', update, { passive: true })
    el.addEventListener('scrollend', update)
    const wheel = (e: WheelEvent) => {
      const d = Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX
      if (!d || el.scrollWidth <= el.clientWidth) return
      e.preventDefault()
      el.scrollLeft += d
    }
    el.addEventListener('wheel', wheel, { passive: false })
    return () => {
      ro.disconnect()
      el.removeEventListener('scroll', update)
      el.removeEventListener('scrollend', update)
      el.removeEventListener('wheel', wheel)
    }
  }, [boards.length])

  useEffect(() => {
    ref.current?.querySelector('.tab.on')?.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' })
  }, [boardId, boards.length])

  const swallowClick = useRef(false)
  const onPointerDown = (e: React.PointerEvent) => {
    const el = ref.current!
    if (e.button !== 0 || el.scrollWidth <= el.clientWidth) return
    const x0 = e.clientX
    const left0 = el.scrollLeft
    let dragging = false
    const move = (ev: PointerEvent) => {
      if (!dragging && Math.abs(ev.clientX - x0) < 4) return
      if (!dragging) {
        dragging = true
        el.setPointerCapture(e.pointerId)
        el.classList.add('dragging')
      }
      el.scrollLeft = left0 - (ev.clientX - x0)
    }
    const up = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      if (!dragging) return
      el.classList.remove('dragging')
      swallowClick.current = true
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
  }

  return (
    <nav
      ref={ref}
      className={'tabs' + (fade.left ? ' fade-left' : '') + (fade.right ? ' fade-right' : '')}
      onPointerDown={onPointerDown}
      onClickCapture={(e) => {
        if (swallowClick.current) {
          swallowClick.current = false
          return e.stopPropagation()
        }
        // Any clicked tab (including the active one, which opens its editor) comes fully into view.
        ;(e.target as Element).closest('.tab')?.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' })
      }}
    >
      {children}
    </nav>
  )
}

function BoardEditor({ board, open, canDelete }: { board: Artboard; open: boolean; canDelete: boolean }) {
  const { updateBoard, duplicateBoard, removeBoard, setBoardEditor } = useStore.getState()
  const size = (n: number) => Math.max(16, Math.min(8192, Math.round(n)))
  return (
    <Popover open={open} onClose={() => setBoardEditor(null)} className="board-editor">
      <input
        className="text"
        defaultValue={board.name}
        autoFocus
        onFocus={(e) => e.target.select()}
        onBlur={(e) => e.target.value.trim() && updateBoard(board.id, { name: e.target.value.trim() })}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
      <div className="wh">
        <NumberField label="W" value={board.width} min={16} max={8192} onChange={(v) => updateBoard(board.id, { width: size(v) })} />
        <button className="icon-btn" title="Swap" onClick={() => updateBoard(board.id, { width: board.height, height: board.width })}>
          ⇄
        </button>
        <NumberField label="H" value={board.height} min={16} max={8192} onChange={(v) => updateBoard(board.id, { height: size(v) })} />
      </div>
      <div className="presets">
        {PRESETS.map((p) => (
          <button
            key={p.name}
            className={'chip' + (p.width === board.width && p.height === board.height ? ' on' : '')}
            onClick={() => updateBoard(board.id, { width: p.width, height: p.height })}
          >
            {p.width}×{p.height}
          </button>
        ))}
      </div>
      <div className="menu-sep" />
      <div className="editor-actions">
        <button className="ghost" onClick={() => duplicateBoard(board.id)}>
          <Icon name="duplicate" size={14} />
          Duplicate
        </button>
        {canDelete && (
          <button
            className="ghost danger"
            onClick={() => {
              removeBoard(board.id)
              useStore.getState().showHud(`Deleted “${board.name}” · ${api.platform === 'darwin' ? '⌘' : 'Ctrl+'}Z to undo`)
            }}
          >
            <Icon name="trash" size={14} />
            Delete
          </button>
        )}
      </div>
    </Popover>
  )
}
