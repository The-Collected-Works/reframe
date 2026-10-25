import { createContext, Fragment, memo, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { drawFrame, resolveSettings } from '@shared/layout'
import type { Artboard, Clip, SkippedFolder, AssetEntry } from '@shared/types'
import { dragOffset, NO_GUIDES, type Guides } from '../interact'
import { posterTime } from '@shared/media'
import { observeVisibility, scheduleDraw } from '../lazydraw'
import { mediaUrl, prioritize } from '../media'
import { basename } from '../paths'
import { assetMenu, excludedFolderMenu, folderMenu, includeFolder } from '../menus'
import { baseName, folderOf, hasOverrides, layoutOf, useBoard, useStore, withMeta, type FolderNode } from '../store'
import { fmtTime, Icon } from './ui'

const GAP = 8
/** Mat around each frame; matches .cell padding in styles.css. */
const PAD = 10
/**
 * Horizontal padding of the scroller (matches .grid-scroll): 26 on the left, 16 on the right
 * beside the 10px scrollbar lane. With the 10px mat, frame-to-edge is 36px on every side,
 * deliberately larger than frame-to-frame (PAD + GAP + PAD = 28) so the grid sits inside a margin.
 */
const EDGE_LEFT = 26
const EDGE_RIGHT = 16

/**
 * Stays mounted (hidden) while the single view is open, so switching back is instant and keeps
 * its scroll position. While hidden its board is frozen, so edits don't re-render every cell.
 */
export function Grid({ active }: { active: boolean }) {
  const hasAssets = useStore((s) => s.assets.length > 0)
  const dir = useStore((s) => s.dir)
  const skipped = useStore((s) => s.skipped)
  const truncated = useStore((s) => s.truncated)
  const viewPrefs = useStore((s) => s.viewPrefs)
  const { tree, visible } = useStore(layoutOf)
  // A flat folder needs no headers; as soon as there are subfolders (or excluded ones), every
  // folder gets one.
  const sectioned = viewPrefs.group && (tree.length > 1 || (tree.length === 1 && tree[0].folder !== ''))
  const rootName = dir ? basename(dir) : ''
  const cellSize = useStore((s) => s.cellSize)
  const current = useBoard()
  const frozen = useRef(current)
  if (active) frozen.current = current
  const board = frozen.current
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)

  useLayoutEffect(() => {
    const el = ref.current!
    const ro = new ResizeObserver(() => setWidth(el.clientWidth - EDGE_LEFT - EDGE_RIGHT))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Cells are sized so the artboard's longer side is roughly `cellSize`.
  const aspect = board.width / board.height
  const target = aspect >= 1 ? cellSize : cellSize * aspect
  const cols = Math.max(1, Math.floor((width + GAP) / (target + PAD * 2 + GAP)))
  // Exact (fractional) widths, so no rounding leftover piles up on the right.
  const cellW = width > 0 ? (width - GAP * (cols - 1)) / cols : 0

  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null)

  // Box select from anywhere that isn't a thumbnail (thumbnails drag to reposition instead).
  // Shift / ⌘ / Ctrl add to the selection. A click without dragging selects or clears.
  const onPointerDown = (e: React.PointerEvent) => {
    const t = e.target as HTMLElement
    if (e.button !== 0 || t.closest('.frame')) return
    const el = ref.current!
    const st = useStore.getState()
    const cellEl = t.closest<HTMLElement>('.cell')
    const additive = e.shiftKey || e.metaKey || e.ctrlKey
    const base = additive ? st.selection : []
    const box = el.getBoundingClientRect()
    const toContent = (cx: number, cy: number) => ({ x: cx - box.left + el.scrollLeft, y: cy - box.top + el.scrollTop })
    const start = toContent(e.clientX, e.clientY)
    const order = visible.map((a) => a.name)
    let last = { x: e.clientX, y: e.clientY }
    let active = false
    let raf = 0
    el.setPointerCapture(e.pointerId)

    const update = () => {
      const p = toContent(last.x, last.y)
      const m = { x: Math.min(start.x, p.x), y: Math.min(start.y, p.y), w: Math.abs(p.x - start.x), h: Math.abs(p.y - start.y) }
      setMarquee(m)
      const hits = new Set(base)
      for (const c of el.querySelectorAll<HTMLElement>('.cell')) {
        const r = c.getBoundingClientRect()
        const cx = r.left - box.left + el.scrollLeft
        const cy = r.top - box.top + el.scrollTop
        if (cx < m.x + m.w && cx + r.width > m.x && cy < m.y + m.h && cy + r.height > m.y) hits.add(c.dataset.name!)
      }
      st.setSelection(order.filter((n) => hits.has(n)))
    }
    // Scroll while the pointer is held near the top or bottom edge.
    const autoscroll = () => {
      const edge = 40
      const dy =
        last.y < box.top + edge ? -(box.top + edge - last.y) / 3 : last.y > box.bottom - edge ? (last.y - box.bottom + edge) / 3 : 0
      if (dy) {
        el.scrollTop += dy
        update()
      }
      raf = requestAnimationFrame(autoscroll)
    }
    const move = (ev: PointerEvent) => {
      last = { x: ev.clientX, y: ev.clientY }
      if (!active && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 4) return
      if (!active) {
        active = true
        raf = requestAnimationFrame(autoscroll)
      }
      update()
    }
    const up = () => {
      cancelAnimationFrame(raf)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      setMarquee(null)
      if (active) return
      if (cellEl) st.select(cellEl.dataset.name!, e.shiftKey ? 'range' : e.metaKey || e.ctrlKey ? 'toggle' : 'replace')
      else if (!additive) st.clearSelection()
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
  }

  return (
    <div className={'grid-scroll' + (sectioned ? ' sectioned' : '') + (active ? '' : ' inactive')} ref={ref} onPointerDown={onPointerDown} onScroll={() => (lastScroll = performance.now())}>
      {/* The folders as the tree they are: each holds its header, its own thumbnails and its
          subfolders, so folding, hover tints and sticky headers all follow from the nesting. */}
      {cellW > 0 && (
        <FolderContext.Provider value={{ cols, cellW, board, active, names: viewPrefs.names, withFolder: !viewPrefs.group, headers: !!sectioned, rootName }}>
          {tree.map((node) => (
            <Folder key={node.folder || '/'} node={node} />
          ))}
        </FolderContext.Provider>
      )}
      {hasAssets && !tree.length && <div className="empty-hint center">Nothing matches this filter</div>}
      {((skipped.length > 0 && !sectioned) || truncated) && (
        <div className="grid-foot">
          {skipped.length > 0 && !sectioned && (
            <div className="grid-foot-row">
              <span className="muted">Not shown</span>
              {skipped.map((f) => (
                <button key={f.path} className="skipped-folder" title={`${f.reason === 'export' ? 'Reframe exports' : 'Excluded'}. Click to include it`} onClick={() => includeFolder(f.path)}>
                  <Icon name="folder" size={12} />
                  {f.path.split('/').join(' / ')}
                  <span className="muted">{f.reason === 'export' ? 'exports' : 'excluded'}</span>
                </button>
              ))}
            </div>
          )}
          {truncated && <div className="muted">Stopped at 20,000 files. Open a subfolder to see the rest.</div>}
        </div>
      )}
      {marquee && (
        <div className="marquee" style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }} />
      )}
    </div>
  )
}

/** What every folder in the grid needs from the grid: column layout, the board, and display options. */
const FolderContext = createContext<{
  cols: number
  cellW: number
  board: Artboard
  active: boolean
  names: boolean
  withFolder: boolean
  /** Grouped by folder: headers, folding. Off, a folder is just its thumbnails. */
  headers: boolean
  rootName: string
} | null>(null)

/**
 * A folder: its header, then a body holding its own thumbnails and its subfolders. Collapsing folds
 * the body, so everything inside goes with it. Hovering the header tints the folder's own box (a
 * rounded card), which contains its subfolders, so the tint covers exactly what a click would fold.
 */
function Folder({ node }: { node: FolderNode }) {
  const g = useContext(FolderContext)!
  const grid = node.assets.length > 0 && (
    <div className="grid" style={{ gridTemplateColumns: `repeat(${g.cols}, ${g.cellW}px)`, gap: GAP }}>
      {node.assets.map((a) => (
        <Cell key={a.name} entry={a} board={g.board} width={g.cellW - PAD * 2} active={g.active} names={g.names} withFolder={g.withFolder} />
      ))}
    </div>
  )
  if (!g.headers) return <div className="grid-folder">{grid}</div>
  if (node.excluded) {
    return (
      <div className="grid-folder excluded" data-folder={node.folder}>
        <ExcludedBar folder={node.excluded} />
      </div>
    )
  }
  return (
    <div className={'grid-folder' + (node.collapsed ? ' collapsed' : '')} data-folder={node.folder}>
      <FolderHeader node={node} rootName={g.rootName} />
      <Collapsible open={!node.collapsed}>
        <div className="folder-body">
          {grid}
          {node.children.map((c) => (
            <Folder key={c.folder} node={c} />
          ))}
        </div>
      </Collapsible>
    </div>
  )
}

/**
 * A folder's header. It sticks to the top while its folder scrolls by; a subfolder's header slides
 * over it there while the subfolder passes, so one bar always says where you are. The whole bar is
 * the control (click to fold the folder away): folder icon and full path, then the count of
 * everything inside and the collapse chevron, pointing in toward the path while collapsed.
 */
function FolderHeader({ node, rootName }: { node: FolderNode; rootName: string }) {
  const { folder, collapsed } = node
  return (
    <button
      className={'grid-section' + (collapsed ? ' collapsed' : '')}
      title={`${folder ? `${rootName}/${folder}` : rootName}. Click to ${collapsed ? 'expand' : 'collapse'}`}
      aria-expanded={!collapsed}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={() => useStore.getState().toggleCollapsed(folder)}
      onContextMenu={(e) => {
        e.preventDefault()
        folderMenu(folder, { x: e.clientX, y: e.clientY })
      }}
    >
      <FolderName folder={folder} />
      <span className="section-count">{node.count}</span>
      <span className="section-chevron" aria-hidden>
        <Icon name="chevronDown" size={14} />
      </span>
    </button>
  )
}

/** When the grid last scrolled. Hover previews wait for it to settle (see Cell). */
let lastScroll = 0
const SCROLL_SETTLE = 250
const PREVIEW_DWELL = 150

/** Folder icon and the full path from a leading slash, parents muted: "/" for the top level, "/ Shoot A / Day 2". */
function FolderName({ folder }: { folder: string }) {
  const crumbs = folder ? folder.split('/') : ['/']
  return (
    <>
      <span className="section-icon" aria-hidden>
        <Icon name="folder" size={13} />
      </span>
      <span className="section-path">
        {/* Nested folders keep the top level's leading slash, so every path reads from "/". */}
        {folder && (
          <span className="section-sep" aria-hidden>
            /
          </span>
        )}
        {crumbs.map((c, i) => (
          <Fragment key={i}>
            {i > 0 && (
              <span className="section-sep" aria-hidden>
                /
              </span>
            )}
            <span className={i === crumbs.length - 1 ? 'section-crumb current' : 'section-crumb'}>{c}</span>
          </Fragment>
        ))}
      </span>
    </>
  )
}

/**
 * An excluded folder (or Reframe's exports), dimmed in its place among the folders, with a tag
 * saying why. It tints on hover like any folder, but a click does nothing (clicking a bar is how
 * other folders collapse, so a click here shouldn't quietly bring it back): including it again is
 * in its right-click menu.
 */
function ExcludedBar({ folder }: { folder: SkippedFolder }) {
  const exports = folder.reason === 'export'
  return (
    <div
      className="grid-section excluded"
      title={`${exports ? 'Reframe’s exports, left out of the project' : 'Excluded from the project'}. Right-click to include it`}
      onPointerDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => {
        e.preventDefault()
        excludedFolderMenu(folder.path, { x: e.clientX, y: e.clientY })
      }}
    >
      <FolderName folder={folder.path} />
      <span className="excluded-tag">{exports ? 'Exports' : 'Excluded'}</span>
    </div>
  )
}

/** How long a folder takes to open or close; matches --t-fold in styles.css. */
const FOLD_MS = 380

/**
 * A section's thumbnails, folding open and closed by animating the row's height (0fr ↔ 1fr), with a
 * fade. Closed, they're unmounted once the fold has finished, so a collapsed folder costs nothing;
 * opening mounts them at zero height first, so the open animates from there.
 */
function Collapsible({ open, children }: { open: boolean; children: React.ReactNode }) {
  const [mounted, setMounted] = useState(open)
  const [expanded, setExpanded] = useState(open)
  useLayoutEffect(() => {
    if (open) {
      setMounted(true)
      // Two frames: the closed state has to be painted before the open one can transition from it.
      let raf = requestAnimationFrame(() => (raf = requestAnimationFrame(() => setExpanded(true))))
      return () => cancelAnimationFrame(raf)
    }
    setExpanded(false)
    const t = setTimeout(() => setMounted(false), FOLD_MS + 40)
    return () => clearTimeout(t)
  }, [open])
  return (
    <div className={'collapsible' + (expanded ? ' open' : '')}>
      <div className="collapsible-inner">{mounted && children}</div>
    </div>
  )
}

function release(v: HTMLVideoElement) {
  v.pause()
  v.removeAttribute('src')
  v.load()
}

const Cell = memo(function Cell({
  entry,
  board,
  width,
  active,
  names,
  withFolder
}: {
  entry: AssetEntry
  board: Artboard
  width: number
  active: boolean
  /** Show the caption row (name, adjusted dot, duration). */
  names: boolean
  /** Prefix the name with its folder (when the grid isn't grouped by folder). */
  withFolder: boolean
}) {
  // Only this cell's own loaded details: another thumbnail arriving doesn't re-render it.
  const meta = useStore((s) => s.meta[entry.name])
  const asset = useMemo(() => withMeta(entry, meta), [entry, meta])
  const selected = useStore((s) => s.selection.includes(asset.name))
  const focused = useStore((s) => s.focus === asset.name)
  const clip = useStore((s) => s.project.clips[asset.name]) as Clip | undefined
  const canvas = useRef<HTMLCanvasElement>(null)
  const [hover, setHover] = useState(false)
  const picking = useStore((s) => s.picking)
  const settings = resolveSettings(board, asset.name)
  const height = Math.round((width * board.height) / board.width)
  const overridden = hasOverrides(board, asset.name)

  const k = width / board.width
  // Hover preview: `live` is the playing video, crossfaded over the thumbnail by `fade` (0..1).
  const live = useRef<HTMLVideoElement | null>(null)
  const fade = useRef(0)
  const fadeRaf = useRef(0)
  const layer = useRef<OffscreenCanvas | null>(null)
  const guides = useRef<Guides>(NO_GUIDES)
  const frame = useRef<HTMLDivElement>(null)
  const visible = useRef(false)
  // What's on the canvas, so unchanged cells skip redrawing.
  const drawn = useRef('')
  const key = `${JSON.stringify(settings)}|${width}x${height}@${window.devicePixelRatio}|${asset.w}x${asset.h}|${asset.mtime}|${!!asset.thumb}`

  const draw = () => {
    const c = canvas.current
    if (!c) return
    const dpr = window.devicePixelRatio || 1
    const pw = Math.round(width * dpr)
    const ph = Math.round(height * dpr)
    if (c.width !== pw || c.height !== ph) {
      c.width = pw
      c.height = ph
    }
    // First draw fades the thumbnail in (CSS), and tells view transitions it has pixels.
    if (!c.dataset.ready && asset.thumb) c.dataset.ready = '1'
    const ctx = c.getContext('2d')!
    const kk = k * dpr
    const video = fade.current > 0 ? live.current : null
    if (video && fade.current >= 1) {
      drawFrame(ctx, video, asset.w, asset.h, board.width, board.height, settings, kk)
    } else {
      drawFrame(ctx, asset.thumb, asset.w, asset.h, board.width, board.height, settings, kk)
      if (video) {
        // Compose the video frame on its own, then lay it over the thumbnail. Fading drawFrame
        // directly would also fade in its background fill and darken the blend mid-way.
        if (!layer.current || layer.current.width !== pw || layer.current.height !== ph) layer.current = new OffscreenCanvas(pw, ph)
        drawFrame(layer.current.getContext('2d')!, video, asset.w, asset.h, board.width, board.height, settings, kk)
        ctx.globalAlpha = fade.current
        ctx.drawImage(layer.current, 0, 0)
        ctx.globalAlpha = 1
      }
    }
    const g = guides.current
    if (g.x.length || g.y.length) {
      ctx.strokeStyle = '#ff4f8b'
      ctx.lineWidth = dpr
      ctx.beginPath()
      for (const x of g.x) {
        const sx = Math.min(pw - 0.5, Math.max(0.5, Math.round(x * kk) + 0.5))
        ctx.moveTo(sx, 0)
        ctx.lineTo(sx, ph)
      }
      for (const y of g.y) {
        const sy = Math.min(ph - 0.5, Math.max(0.5, Math.round(y * kk) + 0.5))
        ctx.moveTo(0, sy)
        ctx.lineTo(pw, sy)
      }
      ctx.stroke()
    }
    drawn.current = video || g.x.length || g.y.length ? '' : key
  }

  const drawRef = useRef(draw)
  drawRef.current = draw
  const task = useRef(() => drawRef.current()).current
  const request = () => {
    if (active && visible.current && (drawn.current !== key || live.current)) scheduleDraw(task)
  }
  const requestRef = useRef(request)
  requestRef.current = request
  useEffect(request)

  useEffect(
    () =>
      observeVisibility(frame.current!, (v) => {
        visible.current = v
        if (v && !asset.thumb) prioritize(asset.path)
        requestRef.current()
      }),
    [asset.path, asset.thumb]
  )

  // A hover becomes a preview only once the pointer has rested on the thumbnail and the grid has
  // stopped scrolling: thumbnails sliding under a still pointer mid-scroll shouldn't each start
  // loading and decoding a video.
  const [previewing, setPreviewing] = useState(false)
  useEffect(() => {
    if (!hover || asset.kind !== 'video') return setPreviewing(false)
    const since = performance.now()
    let t: ReturnType<typeof setTimeout> | undefined
    const check = () => {
      const now = performance.now()
      const wait = Math.max(since + PREVIEW_DWELL - now, lastScroll + SCROLL_SETTLE - now)
      if (wait > 0) t = setTimeout(check, wait)
      else setPreviewing(true)
    }
    check()
    return () => clearTimeout(t)
  }, [hover, asset.kind])

  // Hover to preview video in place. Starts on the thumbnail's own frame and only fades in once
  // the video has actually presented a frame, so there's no jump or blank flash either way.
  useEffect(() => {
    // Not while the eyedropper is open: the exact thumbnail is what should be on screen.
    if (!previewing || picking || asset.kind !== 'video' || !asset.w) return
    const v = document.createElement('video') as HTMLVideoElement & {
      requestVideoFrameCallback?: (cb: () => void) => number
    }
    v.crossOrigin = 'anonymous'
    v.muted = true
    v.playsInline = true
    v.preload = 'auto'
    v.src = mediaUrl(asset.path)
    const start = clip?.start ?? 0
    const end = clip?.end ?? asset.duration
    v.currentTime = Math.min(Math.max(posterTime(asset.duration), start), Math.max(start, end - 0.1))
    let alive = true

    // One fade per cell at a time; starting a new one supersedes any in flight.
    const fadeTo = (target: number, done?: () => void) => {
      cancelAnimationFrame(fadeRaf.current)
      const from = fade.current
      const t0 = performance.now()
      const step = () => {
        const t = Math.min(1, (performance.now() - t0) / 180)
        fade.current = from + (target - from) * (1 - Math.pow(1 - t, 3))
        drawRef.current()
        if (t < 1) fadeRaf.current = requestAnimationFrame(step)
        else done?.()
      }
      fadeRaf.current = requestAnimationFrame(step)
    }

    // Redraw on every presented video frame (fall back to rAF), looping within the trim.
    const onFrame = () => {
      if (!alive) return
      if (v.currentTime >= end - 0.03) v.currentTime = start
      if (live.current === v) drawRef.current()
      if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(onFrame)
      else requestAnimationFrame(onFrame)
    }
    const first = () => {
      if (!alive) return
      // A previous hover may still be fading out; this one takes over from its current opacity.
      if (live.current && live.current !== v) release(live.current)
      live.current = v
      fadeTo(1)
      onFrame()
    }
    v.play()
      .then(() => (v.requestVideoFrameCallback ? v.requestVideoFrameCallback(first) : requestAnimationFrame(first)))
      .catch(() => {})

    return () => {
      alive = false
      if (live.current !== v) return release(v)
      // Hold the last frame and fade back to the thumbnail.
      v.pause()
      fadeTo(0, () => {
        if (live.current === v) live.current = null
        release(v)
      })
    }
  }, [previewing, picking, asset.path, asset.w, asset.duration, clip?.start, clip?.end])

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    const st = useStore.getState()
    const mode = e.shiftKey ? 'range' : e.metaKey || e.ctrlKey ? 'toggle' : 'replace'
    if (mode !== 'replace') return st.select(asset.name, mode)
    if (selected) useStore.setState({ focus: asset.name })
    else st.select(asset.name)
    if (!asset.w) return

    const el = e.currentTarget as HTMLElement
    el.setPointerCapture(e.pointerId)
    const start = resolveSettings(board, asset.name)
    const x0 = e.clientX
    const y0 = e.clientY
    let dragging = false
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - x0) / k
      const dy = (ev.clientY - y0) / k
      if (!dragging && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4) return
      dragging = true
      const r = dragOffset(start, board.width, board.height, asset.w, asset.h, dx, dy, 5 / k, { shift: ev.shiftKey, alt: ev.altKey })
      guides.current = r.guides
      useStore.getState().editAsset(asset.name, r.patch)
    }
    const up = () => {
      guides.current = NO_GUIDES
      drawRef.current()
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      if (!dragging) useStore.getState().select(asset.name)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
  }

  return (
    <div
      data-name={asset.name}
      onContextMenu={(e) => {
        e.preventDefault()
        assetMenu(asset.name, asset.path, { x: e.clientX, y: e.clientY })
      }}
      className={'cell' + (selected ? ' selected' : '') + (focused ? ' focused' : '') + (settings.skip ? ' skipped' : '')}>
      <div
        ref={frame}
        className="frame"
        style={{ height }}
        onPointerDown={onPointerDown}
        onDoubleClick={() => useStore.getState().setView('loupe')}
        onPointerEnter={() => setHover(true)}
        onPointerLeave={() => setHover(false)}
      >
        <canvas ref={canvas} style={{ width, height }} />
        {!asset.thumb && !asset.error && <div className="cell-loading" />}
        {asset.error && <div className="cell-error">Can’t read file</div>}
      </div>
      {names && (
        <div className="cell-meta">
          {overridden && <span className="dot" title="Adjusted" />}
          <span className="cell-name" title={asset.name}>
            {withFolder && folderOf(asset.name) && <span className="cell-folder">{folderOf(asset.name)}/</span>}
            {baseName(asset.name)}
          </span>
          {asset.kind === 'video' && asset.duration > 0 && <span className="cell-dur">{fmtTime((clip?.end ?? asset.duration) - (clip?.start ?? 0))}</span>}
        </div>
      )}
    </div>
  )
})
