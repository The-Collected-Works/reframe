import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Artboard, ReleaseNote, UpdateStatus } from '@shared/types'
import { version } from '../../../../package.json'
import { ALT, combo, MOD, SHIFT } from '../keys'
import { api } from '../media'
import { boardMenu, showMenu } from '../menus'
import { reducedMotion } from '../motion'
import { PRESETS, useStore, VIEW_DEFAULTS, type FilterKey, type SortKey, type ViewPrefs } from '../store'
import { Icon, NumberField, Popover, Segmented } from './ui'

const basename = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p

export function TopBar({ onOpen }: { onOpen: (dir?: string) => void }) {
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
      <FolderMenu dir={dir} onOpen={onOpen} />

      {dir && (
        <div className="tabs-wrap">
          <TabStrip>
            {boards.map((b, i) => (
              <div key={b.id} className="tab-wrap">
                <button
                  className={'tab' + (b.id === boardId ? ' on' : '') + (editor === b.id ? ' editing' : '')}
                  title={b.id === boardId ? 'Edit artboard' : i < 9 ? combo(MOD, String(i + 1)) : undefined}
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
      <AppInfo />

      {dir && (
        <div className="tools">
          {view === 'grid' && <ViewOptions />}
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
              { value: 'grid', label: <Icon name="grid" size={15} />, title: 'Grid (E)' },
              { value: 'loupe', label: <Icon name="loupe" size={15} />, title: 'Single (E)' }
            ]}
            onChange={setView}
          />
          <button className="primary" onClick={() => setExportOpen(true)} title={`Export (${combo(MOD, 'E')})`}>
            <Icon name="export" size={14} />
            Export
          </button>
        </div>
      )}
    </header>
  )
}

const FILTERS: { value: FilterKey; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'images', label: 'Images' },
  { value: 'videos', label: 'Videos' },
  { value: 'adjusted', label: 'Adjusted' },
  { value: 'excluded', label: 'Excluded from export' }
]
const SORTS: { value: SortKey; label: string }[] = [
  { value: 'name', label: 'Name' },
  { value: 'date', label: 'Date modified' },
  { value: 'type', label: 'Type' }
]

/**
 * Grid view options: what to show, how to sort it, grouping by folder, captions, and folding
 * every folder at once. It stays open while things are changed; a dot on the button says a
 * filter is hiding something.
 */
function ViewOptions() {
  const [open, setOpen] = useState(false)
  const prefs = useStore((s) => s.viewPrefs)
  const hasFolders = useStore((s) => s.assets.some((a) => a.name.includes('/')))
  const anyCollapsed = useStore((s) => s.collapsed.length > 0)
  const { setViewPrefs, setAllCollapsed, resetView } = useStore.getState()
  const changed = anyCollapsed || (Object.keys(VIEW_DEFAULTS) as (keyof ViewPrefs)[]).some((k) => prefs[k] !== VIEW_DEFAULTS[k])
  const filter = FILTERS.find((f) => f.value === prefs.filter)!
  const option = (on: boolean, label: string, onClick: () => void) => (
    <button key={label} className="menu-item" onClick={onClick}>
      <span>{label}</span>
      {on && <Icon name="check" size={14} />}
    </button>
  )
  return (
    <div className="tab-wrap">
      <button
        className={'icon-btn view-btn' + (open ? ' on' : '') + (prefs.filter !== 'all' ? ' filtered' : '')}
        title={prefs.filter !== 'all' ? `View options (showing ${filter.label.toLowerCase()})` : 'View options'}
        onClick={() => setOpen(!open)}
        onContextMenu={async (e) => {
          e.preventDefault()
          const id = await showMenu(e.clientX, e.clientY, [{ id: 'reset', label: 'Reset View', icon: 'reset', enabled: changed }])
          if (id === 'reset') resetView()
        }}
      >
        <Icon name="viewOptions" size={15} />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} className="menu view-menu">
        <div className="menu-label">Show</div>
        {FILTERS.map((f) => option(prefs.filter === f.value, f.label, () => setViewPrefs({ filter: f.value })))}
        <div className="menu-sep" />
        <div className="menu-label">Sort by</div>
        {SORTS.map((o) => option(prefs.sort === o.value, o.label, () => setViewPrefs({ sort: o.value })))}
        <div className="menu-sep" />
        {option(prefs.group, 'Group by folder', () => setViewPrefs({ group: !prefs.group }))}
        {option(prefs.names, 'Show file names', () => setViewPrefs({ names: !prefs.names }))}
        {hasFolders && prefs.group && (
          <>
            <div className="menu-sep" />
            {option(false, 'Collapse all folders', () => setAllCollapsed(true))}
            {option(false, 'Expand all folders', () => setAllCollapsed(false))}
          </>
        )}
        <div className="menu-sep" />
        <button className="menu-item" disabled={!changed} onClick={resetView}>
          <span>Reset View</span>
        </button>
      </Popover>
    </div>
  )
}

/**
 * The folder button: a menu with Open Folder… and the folders opened recently, newest first (so
 * the open one leads). Each recent folder can be dropped from the list.
 */
function FolderMenu({ dir, onOpen }: { dir: string | null; onOpen: (dir?: string) => void }) {
  const [open, setOpen] = useState(false)
  const [recent, setRecent] = useState<string[]>([])
  useEffect(() => {
    if (open) api.recentFolders().then(setRecent, () => {})
  }, [open])
  const shown = recent.slice(0, 5)
  const pick = (d?: string) => {
    setOpen(false)
    // Picking the folder that's already open just closes the menu.
    if (!(d && dir && samePath(d, dir))) onOpen(d)
  }
  return (
    <div className="tab-wrap">
      <button className={'folder' + (open ? ' open' : '')} title={dir ?? undefined} onClick={() => setOpen(!open)}>
        <Icon name="folder" size={15} />
        <span>{dir ? basename(dir) : 'Open folder'}</span>
      </button>
      <Popover open={open} onClose={() => setOpen(false)} className="menu folder-menu">
        <button className="menu-item" onClick={() => pick()}>
          <span>Open Folder…</span>
          <span className="muted">{combo(MOD, 'O')}</span>
        </button>
        {shown.length > 0 && (
          <>
            <div className="menu-sep" />
            <div className="menu-label">Recent</div>
            {shown.map((d) => {
              return (
                <div key={d} className="recent">
                  <button className="menu-item" title={d} onClick={() => pick(d)}>
                    <span className="recent-name">{basename(d) || d}</span>
                    <span className="recent-path muted">{shortParent(d)}</span>
                  </button>
                  <button
                    className="recent-forget"
                    title="Remove from recent folders"
                    aria-label="Remove from recent folders"
                    onClick={() => api.forgetFolder(d).then(setRecent, () => {})}
                  >
                    <Icon name="close" size={12} />
                  </button>
                </div>
              )
            })}
          </>
        )}
      </Popover>
    </div>
  )
}

const samePath = (a: string, b: string) => a.replace(/[\\/]+$/, '').toLowerCase() === b.replace(/[\\/]+$/, '').toLowerCase()

/** The folder's parent, keeping its last two parts: "…\Clients\Acme". */
function shortParent(path: string): string {
  const sep = path.includes('\\') ? '\\' : '/'
  const parts = path.split(/[\\/]/).filter(Boolean)
  parts.pop()
  if (parts.length <= 2) return (path.startsWith('/') ? '/' : '') + parts.join(sep)
  return '…' + sep + parts.slice(-2).join(sep)
}

type Update = { version: string; notes: ReleaseNote[]; status: UpdateStatus }

/**
 * Checks for a newer release shortly after launch and every few hours; null until there is one.
 * The installed Windows app then downloads it itself, reporting progress as it goes.
 */
function useUpdateCheck(): Update | null {
  const [update, setUpdate] = useState<Update | null>(null)
  useEffect(() => {
    const check = () => api.checkUpdate().then((u) => setUpdate(u ?? null), () => {})
    const first = setTimeout(check, 3000)
    const every = setInterval(check, 6 * 60 * 60 * 1000)
    const off = api.onUpdateStatus((status) => setUpdate((u) => u && { ...u, status }))
    return () => {
      clearTimeout(first)
      clearInterval(every)
      off()
    }
  }, [])
  return update
}

/**
 * Hovering reveals what's new: the notes of every release since this build, newest first. The
 * dropdown stays open while the pointer moves between the two. Clicking opens the release page,
 * or, once the installed app has downloaded the update itself, restarts into it.
 */
function UpdateButton({ update }: { update: Update }) {
  const { open, setOpen, enter, leave, keep } = useHoverOpen()
  const { status } = update
  const ready = status.state === 'ready'
  const downloading = status.state === 'downloading'
  const act = () => (ready ? api.installUpdate() : downloading ? undefined : api.openRelease())
  return (
    <div className="update-wrap" onPointerEnter={enter} onPointerLeave={leave}>
      <button
        className={'update' + (downloading ? ' downloading' : '')}
        style={downloading ? { ['--p' as string]: `${status.percent}%` } : undefined}
        title={open ? undefined : ready ? 'Restart Reframe to finish updating' : `Reframe ${update.version} is available`}
        onClick={act}
      >
        <Icon name="update" size={14} />
        {ready ? (
          'Restart to update'
        ) : downloading ? (
          <>
            Updating
            <span className="muted">{status.percent}%</span>
          </>
        ) : (
          <>
            Update
            <span className="muted">{update.version}</span>
          </>
        )}
      </button>
      <Popover open={open && update.notes.length > 0} onClose={() => setOpen(false)} className="changelog">
        <div className="changelog-body" onPointerEnter={keep} onPointerLeave={leave}>
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
          <button className="ghost changelog-download" disabled={downloading} onClick={act}>
            <Icon name={ready ? 'update' : 'download'} size={14} />
            {ready ? `Restart to update to ${update.version}` : downloading ? `Downloading ${update.version}…` : `Download ${update.version}`}
          </button>
        </div>
      </Popover>
    </div>
  )
}

/**
 * Open on hover: after a short pause (so passing over doesn't flash it), and staying open while
 * the pointer moves from the anchor into the dropdown (`keep`) and briefly after it leaves both.
 */
function useHoverOpen() {
  const [open, setOpen] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const later = (fn: () => void, ms: number) => {
    clearTimeout(timer.current)
    timer.current = setTimeout(fn, ms)
  }
  useEffect(() => () => clearTimeout(timer.current), [])
  return {
    open,
    setOpen,
    enter: () => later(() => setOpen(true), open ? 0 : 180),
    leave: () => later(() => setOpen(false), 220),
    keep: () => clearTimeout(timer.current)
  }
}


/** Every shortcut, grouped. Keys are shown as separate chips; " / " separates alternatives. */
const SHORTCUTS: { title: string; items: [string, string[]][] }[] = [
  {
    title: 'View',
    items: [
      ['Grid / single view', ['E']],
      ['Open selected', ['Space']],
      ['Back to grid, deselect', ['Esc']],
      ['Previous / next asset', ['←', '→']],
      ['Switch artboard', [MOD, '1–9']]
    ]
  },
  {
    title: 'Edit',
    items: [
      ['Copy / paste settings', [MOD, 'C', '/', MOD, 'V']],
      ['Undo / redo', [MOD, 'Z', '/', MOD, SHIFT, 'Z']],
      ['Select all', [MOD, 'A']],
      ['Pick background color', ['I']],
      ['Reset asset to defaults', [MOD, SHIFT, 'R']],
      ['Reset a value', ['Middle-click']]
    ]
  },
  {
    title: 'Single view',
    items: [
      ['Play / pause', ['Space']],
      ['Fit to view', [MOD, '0']],
      ['Zoom in / out', [MOD, '+', '/', MOD, '−']],
      ['Zoom', ['Scroll wheel', '/', 'Pinch']],
      ['Pan', ['Two-finger scroll', '/', 'Middle-drag']],
      ['Scale media', [ALT, 'Scroll']],
      ['Reset transform', ['Double-click']]
    ]
  },
  {
    title: 'While dragging',
    items: [
      ['Stretch (edges, corners)', [SHIFT]],
      ['Scale from center', [ALT]],
      ['Lock axis (move)', [SHIFT]],
      ['15° steps (rotate)', [SHIFT]],
      ['No snapping', [MOD]]
    ]
  },
  {
    title: 'File',
    items: [
      ['Open folder', [MOD, 'O']],
      ['Export', [MOD, 'E']]
    ]
  }
]

/** An info button that toggles a dropdown with the version and every shortcut. */
function AppInfo() {
  const [open, setOpen] = useState(false)
  return (
    <div className="update-wrap">
      <button className={'icon-btn' + (open ? ' on' : '')} title="About Reframe and keyboard shortcuts" aria-label="About Reframe and keyboard shortcuts" onClick={() => setOpen(!open)}>
        <Icon name="info" size={16} />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} className="app-info">
        <div className="app-info-body">
          <header className="app-info-head">
            <span className="release-version">Reframe</span>
            <span className="muted">{version}</span>
          </header>
          <div className="changelog-scroll">
            {SHORTCUTS.map((g) => (
              <section key={g.title} className="keys">
                <h4>{g.title}</h4>
                {g.items.map(([label, keys]) => (
                  <div key={label} className="key-row">
                    <span>{label}</span>
                    <span className="key-combo">
                      {keys.map((k, i) => (k === '/' ? <span key={i} className="key-or">/</span> : <kbd key={i}>{k}</kbd>))}
                    </span>
                  </div>
                ))}
              </section>
            ))}
          </div>
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
              useStore.getState().showHud(`Deleted “${board.name}” · ${combo(MOD, 'Z')} to undo`)
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
