import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { drawFrame, resolveSettings } from '@shared/layout'
import type { Artboard, Clip } from '@shared/types'
import { dragOffset, NO_GUIDES, type Guides } from '../interact'
import { posterTime } from '@shared/media'
import { mediaUrl, prioritize } from '../media'
import { hasOverrides, useBoard, useStore, type Asset } from '../store'
import { fmtTime } from './ui'

const GAP = 8
/** Mat around each frame; matches .cell padding in styles.css. */
const PAD = 10

// Cells draw lazily: only when on (or near) screen, only when their content changed, and through
// a per-frame time budget so a large redraw never blocks input.
const drawQueue = new Set<() => void>()
let drawRaf = 0

function scheduleDraw(task: () => void) {
  drawQueue.add(task)
  if (!drawRaf) drawRaf = requestAnimationFrame(flushDraws)
}

function flushDraws() {
  drawRaf = 0
  const t0 = performance.now()
  for (const task of drawQueue) {
    drawQueue.delete(task)
    task()
    if (performance.now() - t0 > 6) break
  }
  if (drawQueue.size) drawRaf = requestAnimationFrame(flushDraws)
}

let observer: IntersectionObserver | null = null
const onVisibility = new WeakMap<Element, (visible: boolean) => void>()

function observeVisibility(el: Element, cb: (visible: boolean) => void): () => void {
  observer ??= new IntersectionObserver(
    (entries) => entries.forEach((e) => onVisibility.get(e.target)?.(e.isIntersecting)),
    { rootMargin: '400px 0px' }
  )
  onVisibility.set(el, cb)
  observer.observe(el)
  return () => {
    observer?.unobserve(el)
    onVisibility.delete(el)
  }
}

/**
 * Stays mounted (hidden) while the single view is open, so switching back is instant and keeps
 * its scroll position. While hidden its board is frozen, so edits don't re-render every cell.
 */
export function Grid({ active }: { active: boolean }) {
  const assets = useStore((s) => s.assets)
  const cellSize = useStore((s) => s.cellSize)
  const current = useBoard()
  const frozen = useRef(current)
  if (active) frozen.current = current
  const board = frozen.current
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)

  useLayoutEffect(() => {
    const el = ref.current!
    const ro = new ResizeObserver(() => setWidth(el.clientWidth - 32))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Cells are sized so the artboard's longer side is roughly `cellSize`.
  const aspect = board.width / board.height
  const target = aspect >= 1 ? cellSize : cellSize * aspect
  const cols = Math.max(1, Math.floor((width + GAP) / (target + PAD * 2 + GAP)))
  const cellW = width > 0 ? Math.floor((width - GAP * (cols - 1)) / cols) : 0

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
    const order = assets.map((a) => a.name)
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
    <div className={'grid-scroll' + (active ? '' : ' inactive')} ref={ref} onPointerDown={onPointerDown}>
      <div className="grid" style={{ gridTemplateColumns: `repeat(${cols}, ${cellW}px)`, gap: GAP }}>
        {cellW > 0 && assets.map((a) => <Cell key={a.name} asset={a} board={board} width={cellW - PAD * 2} active={active} />)}
      </div>
      {marquee && (
        <div className="marquee" style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }} />
      )}
    </div>
  )
}

function release(v: HTMLVideoElement) {
  v.pause()
  v.removeAttribute('src')
  v.load()
}

const Cell = memo(function Cell({ asset, board, width, active }: { asset: Asset; board: Artboard; width: number; active: boolean }) {
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

  // Hover to preview video in place. Starts on the thumbnail's own frame and only fades in once
  // the video has actually presented a frame, so there's no jump or blank flash either way.
  useEffect(() => {
    // Not while the eyedropper is open: the exact thumbnail is what should be on screen.
    if (!hover || picking || asset.kind !== 'video' || !asset.w) return
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
    const dwell = setTimeout(() => {
      v.play()
        .then(() => (v.requestVideoFrameCallback ? v.requestVideoFrameCallback(first) : requestAnimationFrame(first)))
        .catch(() => {})
    }, 150)

    return () => {
      alive = false
      clearTimeout(dwell)
      if (live.current !== v) return release(v)
      // Hold the last frame and fade back to the thumbnail.
      v.pause()
      fadeTo(0, () => {
        if (live.current === v) live.current = null
        release(v)
      })
    }
  }, [hover, picking, asset.path, asset.w, asset.duration, clip?.start, clip?.end])

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
    <div data-name={asset.name} className={'cell' + (selected ? ' selected' : '') + (focused ? ' focused' : '') + (settings.skip ? ' skipped' : '')}>
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
      <div className="cell-meta">
        {overridden && <span className="dot" title="Adjusted" />}
        <span className="cell-name" title={asset.name}>
          {asset.name}
        </span>
        {asset.kind === 'video' && asset.duration > 0 && <span className="cell-dur">{fmtTime((clip?.end ?? asset.duration) - (clip?.start ?? 0))}</span>}
      </div>
    </div>
  )
})
