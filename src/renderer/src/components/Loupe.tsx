import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { bounds, computeLayout, corners, drawFrame, resolveSettings, toLocal, type Point } from '@shared/layout'
import type { CropSettings } from '@shared/types'
import { dragOffset, NO_GUIDES, rotateAbout, snapAngle, snapZoom, zoomAbout, type Guides } from '../interact'
import { api, loadStill, mediaUrl } from '../media'
import { clipFor, useBoard, useStore } from '../store'
import { fmtTime, Icon } from './ui'

const MARGIN = 56
const CONTROLS = 64
const HANDLE = 4.5
const HIT_HANDLE = 10
const HIT_ROTATE = 30
const ACCENT = '#6e9bff'
const GUIDE = '#ff4f8b'

type Mode = { kind: 'move' } | { kind: 'scale'; corner: number } | { kind: 'rotate' }

const svgCursor = (svg: string, fallback: string) =>
  `url("data:image/svg+xml,${encodeURIComponent(svg)}") 12 12, ${fallback}`
const ROTATE_CURSOR = svgCursor(
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">' +
    '<g fill="none" stroke-linecap="round"><path d="M7 16.5A6.5 6.5 0 1 0 7.6 7.4" stroke="#000" stroke-width="4"/>' +
    '<path d="M7 16.5A6.5 6.5 0 1 0 7.6 7.4" stroke="#fff" stroke-width="1.8"/></g>' +
    '<path d="M4.2 4.6l5.6.6-3.1 4.7z" fill="#fff" stroke="#000" stroke-width="1"/></svg>',
  'crosshair'
)
const RESIZE = ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize']

export function Loupe() {
  const focus = useStore((s) => s.focus)
  const asset = useStore((s) => s.assets.find((a) => a.name === s.focus))
  const index = useStore((s) => s.assets.findIndex((a) => a.name === s.focus))
  const count = useStore((s) => s.assets.length)
  const project = useStore((s) => s.project)
  const board = useBoard()
  const stage = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [still, setStill] = useState<Blob | null>(null)
  const [video, setVideo] = useState<HTMLVideoElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const [queued, setQueued] = useState(false)
  // Paused video frame decoded by ffmpeg, as export will see it. Chromium's own decode can be off
  // by several levels (badly so for full-range video), which would make colour matching misleading.
  const [exact, setExact] = useState<{ t: number; jpeg: Blob } | null>(null)
  const [time, setTime] = useState(0)
  const [cursor, setCursor] = useState('default')
  const [readout, setReadout] = useState<{ x: number; y: number; text: string } | null>(null)
  const picking = useStore((s) => s.picking)
  const hover = useRef(false)
  const dragging = useRef(false)
  const guides = useRef<Guides>(NO_GUIDES)

  const isVideo = asset?.kind === 'video'
  const settings = asset ? resolveSettings(board, asset.name) : board.defaults
  // While a trim handle is dragged its value lives here, and is saved once on release.
  const [trimDraft, setTrimDraft] = useState<{ start: number; end: number } | null>(null)
  const clip = asset && isVideo ? trimDraft ?? clipFor(project, asset.name, asset.duration) : { start: 0, end: 0 }
  const clipRef = useRef(clip)
  clipRef.current = clip

  useLayoutEffect(() => {
    const el = stage.current!
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // View: the board stays centred, zoomed out enough that the media's corners (and so the
  // handles) are on screen. Held still while interacting, then eased to the new framing.
  const interacting = useRef(false)
  const [, settle] = useState(0)
  const target = useRef({ k: 1, bx: 0, by: 0 })
  const availW = size.w - MARGIN * 2
  const availH = size.h - MARGIN * 2 - (isVideo ? CONTROLS : 0)
  if (!interacting.current) {
    const fitK = Math.max(0.01, Math.min(availW / board.width, availH / board.height))
    let k = fitK
    if (asset?.w) {
      const b = bounds(computeLayout(board.width, board.height, asset.w, asset.h, settings))
      const ex = Math.max(board.width / 2, board.width / 2 - b.x, b.x + b.w - board.width / 2)
      const ey = Math.max(board.height / 2, board.height / 2 - b.y, b.y + b.h - board.height / 2)
      k = Math.max(fitK * 0.45, Math.min(fitK, availW / 2 / ex, availH / 2 / ey))
    }
    target.current = { k, bx: (size.w - board.width * k) / 2, by: MARGIN + (availH - board.height * k) / 2 }
  }
  const { k, bx, by } = useEased(target.current, `${size.w}x${size.h}/${asset?.name}/${board.id}`)
  const endInteraction = () => {
    interacting.current = false
    settle((n) => n + 1)
  }

  // Never draw the full-resolution source interactively (a 24MP photo stalls every frame). Draw a
  // copy sized to what's on screen instead, sharpened only when zooming in past it.
  const dpr = window.devicePixelRatio || 1
  const placed = asset?.w ? computeLayout(board.width, board.height, asset.w, asset.h, settings) : null
  const need = placed ? Math.max(placed.w, placed.h) * k * dpr : 0
  const thumbEdge = asset?.thumb ? Math.max(asset.thumb.width, asset.thumb.height) : 0
  const stillProxy = useProxy(still, asset?.w ?? 0, asset?.h ?? 0, need, thumbEdge)
  const exactProxy = useProxy(exact?.jpeg ?? null, asset?.w ?? 0, asset?.h ?? 0, need, 0)

  // Latest render state for event handlers, so they never act on a stale closure.
  const live = useRef({ board, settings, asset, k, bx, by })
  live.current = { board, settings, asset, k, bx, by }

  // Load the full-res still (image, or poster for video).
  useEffect(() => {
    setStill(null)
    if (!asset || !asset.w) return
    let alive = true
    loadStill(asset).then((src) => alive && setStill(src)).catch(() => {})
    return () => {
      alive = false
    }
  }, [asset?.path, asset?.mtime, asset?.w])

  // Video element for playback.
  useEffect(() => {
    setVideo(null)
    setPlaying(false)
    setQueued(false)
    setTrimDraft(null)
    setExact(null)
    if (!asset || asset.kind !== 'video') return
    const v = document.createElement('video')
    v.crossOrigin = 'anonymous'
    v.playsInline = true
    v.preload = 'auto'
    v.src = mediaUrl(asset.path)
    const ready = () => {
      v.currentTime = useStore.getState().project.clips[asset.name]?.start ?? 0
      setVideo(v)
    }
    v.addEventListener('loadeddata', ready, { once: true })
    return () => {
      v.pause()
      v.removeAttribute('src')
      v.load()
    }
  }, [asset?.path, asset?.mtime])

  const draw = useCallback(() => {
    const c = canvas.current
    if (!c || !asset || size.w === 0) return
    const dpr = window.devicePixelRatio || 1
    const pw = Math.round(size.w * dpr)
    const ph = Math.round(size.h * dpr)
    if (c.width !== pw || c.height !== ph) {
      c.width = pw
      c.height = ph
    }
    const ctx = c.getContext('2d')!
    ctx.clearRect(0, 0, pw, ph)
    const useExact = exact && exactProxy && video?.paused && Math.abs(exact.t - video.currentTime) < 0.001
    const src: CanvasImageSource | null = useExact ? exactProxy : video && video.readyState >= 2 ? video : stillProxy ?? asset.thumb
    const kk = k * dpr
    const ox = bx * dpr
    const oy = by * dpr
    const W = board.width
    const H = board.height
    const p = asset.w ? computeLayout(W, H, asset.w, asset.h, settings) : null
    const active = (hover.current || dragging.current) && !picking

    // Overflow outside the board, faintly.
    if (src && p && active) {
      ctx.save()
      ctx.globalAlpha = dragging.current ? 0.3 : 0.14
      ctx.translate(ox + p.cx * kk, oy + p.cy * kk)
      ctx.rotate(p.rot)
      ctx.scale(settings.flipX ? -1 : 1, settings.flipY ? -1 : 1)
      ctx.drawImage(src, (-p.w * kk) / 2, (-p.h * kk) / 2, p.w * kk, p.h * kk)
      ctx.restore()
    }

    ctx.save()
    ctx.translate(ox, oy)
    ctx.beginPath()
    ctx.rect(0, 0, W * kk, H * kk)
    ctx.clip()
    drawFrame(ctx, p ? src : null, asset.w, asset.h, W, H, settings, kk)
    ctx.restore()

    if (!p || !active) return

    // Board edge, so it reads against the overflow.
    ctx.strokeStyle = 'rgba(255,255,255,0.28)'
    ctx.lineWidth = dpr
    ctx.strokeRect(Math.round(ox) + 0.5, Math.round(oy) + 0.5, Math.round(W * kk) - 1, Math.round(H * kk) - 1)

    // Transform box and handles.
    const pts = corners(p).map((pt) => ({ x: ox + pt.x * kk, y: oy + pt.y * kk }))
    ctx.save()
    ctx.lineWidth = dpr
    ctx.strokeStyle = ACCENT
    ctx.beginPath()
    pts.forEach((pt, i) => (i ? ctx.lineTo(pt.x, pt.y) : ctx.moveTo(pt.x, pt.y)))
    ctx.closePath()
    ctx.stroke()
    const hs = HANDLE * dpr
    for (const pt of pts) {
      ctx.save()
      ctx.translate(pt.x, pt.y)
      ctx.rotate(p.rot)
      ctx.fillStyle = '#fff'
      ctx.fillRect(-hs, -hs, hs * 2, hs * 2)
      ctx.strokeRect(-hs, -hs, hs * 2, hs * 2)
      ctx.restore()
    }

    // Smart guides.
    const g = guides.current
    ctx.strokeStyle = GUIDE
    const ext = 14 * dpr
    ctx.beginPath()
    for (const x of g.x) {
      const sx = Math.round(ox + x * kk) + 0.5
      ctx.moveTo(sx, oy - ext)
      ctx.lineTo(sx, oy + H * kk + ext)
    }
    for (const y of g.y) {
      const sy = Math.round(oy + y * kk) + 0.5
      ctx.moveTo(ox - ext, sy)
      ctx.lineTo(ox + W * kk + ext, sy)
    }
    ctx.stroke()
    ctx.restore()
  }, [asset, size, video, stillProxy, exact, exactProxy, k, bx, by, board, settings, picking])

  const drawRef = useRef(draw)
  drawRef.current = draw
  useEffect(draw)

  useEffect(() => {
    if (video) video.muted = settings.mute
  }, [video, settings.mute])

  // The eyedropper samples the screen; pause so it sees the exact frame, not the browser's decode.
  useEffect(() => {
    if (picking && video && !video.paused) video.pause()
  }, [picking, video])

  // While paused, swap in the exact frame shortly after each seek.
  useEffect(() => {
    if (!video || !asset || playing) return
    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const request = () => {
      clearTimeout(timer)
      const t = video.currentTime
      timer = setTimeout(async () => {
        try {
          const data = await api.frame(asset.path, t, asset.color)
          if (alive && video.paused && Math.abs(video.currentTime - t) < 0.001) {
            setExact({ t, jpeg: new Blob([data as BlobPart], { type: 'image/jpeg' }) })
          }
        } catch {
          // Keep showing the browser's frame.
        }
      }, 120)
    }
    request()
    video.addEventListener('seeked', request)
    return () => {
      alive = false
      clearTimeout(timer)
      video.removeEventListener('seeked', request)
    }
  }, [video, asset?.path, playing])

  // Repaint frames while playing, looping within the trim range.
  useEffect(() => {
    if (!video || !asset) return
    let raf = 0
    const tick = () => {
      const { start, end } = clipRef.current
      if (video.currentTime >= end - 0.01 || video.currentTime < start - 0.05) {
        video.currentTime = start
      }
      setTime(video.currentTime)
      drawRef.current()
      if (!video.paused) raf = requestAnimationFrame(tick)
    }
    const onPlay = () => {
      setPlaying(true)
      tick()
    }
    const onPause = () => setPlaying(false)
    const onSeeked = () => {
      if (pendingSeek.current != null) {
        video.currentTime = pendingSeek.current
        pendingSeek.current = null
        return
      }
      setTime(video.currentTime)
      drawRef.current()
    }
    video.addEventListener('play', onPlay)
    video.addEventListener('pause', onPause)
    video.addEventListener('seeked', onSeeked)
    if (!video.paused) tick()
    return () => {
      cancelAnimationFrame(raf)
      video.removeEventListener('play', onPlay)
      video.removeEventListener('pause', onPause)
      video.removeEventListener('seeked', onSeeked)
    }
  }, [video, asset?.name, asset?.duration])

  // Play is never disabled: pressed before the video has loaded (slow drives, network or WSL
  // paths, big files), the intent is queued and playback starts as soon as a frame is ready.
  // At most one seek in flight; while it runs only the newest target is kept. Issuing a seek per
  // pointer move makes the browser abandon most of them and the frame stutters.
  const pendingSeek = useRef<number | null>(null)
  const seek = (t: number) => {
    if (!video) return
    if (video.seeking) pendingSeek.current = t
    else video.currentTime = t
  }

  // A second, muted video just for trim previews, so the main view never has to seek mid-drag.
  const scrubber = useRef<{ v: HTMLVideoElement; pending: number | null; canvas: HTMLCanvasElement | null } | null>(null)
  useEffect(
    () => () => {
      const s = scrubber.current
      scrubber.current = null
      if (s) {
        s.v.removeAttribute('src')
        s.v.load()
      }
    },
    [asset?.path]
  )
  const preview = (canvas: HTMLCanvasElement, t: number) => {
    if (!asset) return
    let s = scrubber.current
    if (!s) {
      const v = document.createElement('video')
      v.muted = true
      v.preload = 'auto'
      v.crossOrigin = 'anonymous'
      v.src = mediaUrl(asset.path)
      const state = { v, pending: null as number | null, canvas: null as HTMLCanvasElement | null }
      const paint = () => {
        const c = state.canvas
        const { board: b, settings: st, asset: a } = live.current
        if (!c || !a?.w || v.readyState < 2) return
        drawFrame(c.getContext('2d')!, v, a.w, a.h, b.width, b.height, st, c.width / b.width)
      }
      const next = () => {
        paint()
        if (state.pending != null) {
          v.currentTime = state.pending
          state.pending = null
        }
      }
      v.addEventListener('seeked', next)
      v.addEventListener('loadeddata', next)
      s = scrubber.current = state
    }
    s.canvas = canvas
    if (s.v.readyState < 2 || s.v.seeking) s.pending = t
    else s.v.currentTime = t
  }

  const toggle = useCallback(() => {
    if (!video) return setQueued((q) => !q)
    if (video.paused) video.play().catch(() => {})
    else video.pause()
  }, [video])

  useEffect(() => {
    if (!video || !queued) return
    setQueued(false)
    video.play().catch(() => {})
  }, [video, queued])

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || (e.target as HTMLElement).closest('input, textarea, button')) return
      e.preventDefault()
      toggle()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [toggle])

  /** Client coordinates → artboard pixels. */
  const toBoard = (clientX: number, clientY: number): Point => {
    const r = stage.current!.getBoundingClientRect()
    const l = live.current
    return { x: (clientX - r.left - l.bx) / l.k, y: (clientY - r.top - l.by) / l.k }
  }

  const hitTest = (pt: Point): { mode: Mode; cursor: string } => {
    const { asset: a, board: b, settings: s, k: kk } = live.current
    if (!a?.w) return { mode: { kind: 'move' }, cursor: 'default' }
    const p = computeLayout(b.width, b.height, a.w, a.h, s)
    const cs = corners(p)
    const dist = cs.map((c) => Math.hypot(c.x - pt.x, c.y - pt.y) * kk)
    const i = dist.indexOf(Math.min(...dist))
    if (dist[i] <= HIT_HANDLE) {
      const ang = (Math.atan2(cs[i].y - p.cy, cs[i].x - p.cx) * 180) / Math.PI
      const dir = Math.round((((ang % 180) + 180) % 180) / 45) % 4
      return { mode: { kind: 'scale', corner: i }, cursor: RESIZE[dir] }
    }
    const l = toLocal(p, pt)
    const inside = l.x >= 0 && l.x <= 1 && l.y >= 0 && l.y <= 1
    if (!inside && dist[i] <= HIT_ROTATE) return { mode: { kind: 'rotate' }, cursor: ROTATE_CURSOR }
    return { mode: { kind: 'move' }, cursor: 'move' }
  }

  // Wheel / pinch zooms about the cursor.
  useEffect(() => {
    const el = stage.current!
    let wheelIdle: ReturnType<typeof setTimeout> | undefined
    const wheel = (e: WheelEvent) => {
      const { asset: a, board: b, settings: s } = live.current
      if (!a?.w) return
      e.preventDefault()
      interacting.current = true
      clearTimeout(wheelIdle)
      wheelIdle = setTimeout(endInteraction, 500)
      const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015))
      const zoom = snapZoom(s.zoom * factor, true)
      useStore.getState().editAsset(a.name, zoomAbout(s, b.width, b.height, a.w, a.h, zoom, toBoard(e.clientX, e.clientY)))
    }
    el.addEventListener('wheel', wheel, { passive: false })
    return () => {
      clearTimeout(wheelIdle)
      el.removeEventListener('wheel', wheel)
    }
  }, [])

  const onPointerMove = (e: React.PointerEvent) => {
    if (dragging.current) return
    if (!hover.current) setHover(true)
    const c = hitTest(toBoard(e.clientX, e.clientY)).cursor
    if (c !== cursor) setCursor(c)
  }

  const onPointerDown = (e: React.PointerEvent) => {
    const { asset: a, board: b, settings: start, k: kk } = live.current
    if (e.button !== 0 || !a?.w) return
    const el = e.currentTarget as HTMLElement
    el.setPointerCapture(e.pointerId)
    const W = b.width
    const H = b.height
    const pt0 = toBoard(e.clientX, e.clientY)
    const { mode } = hitTest(pt0)
    const p0 = computeLayout(W, H, a.w, a.h, start)
    const cs = corners(p0)
    const a0 = Math.atan2(pt0.y - p0.cy, pt0.x - p0.cx)
    const x0 = e.clientX
    const y0 = e.clientY
    const stageRect = stage.current!.getBoundingClientRect()
    dragging.current = true
    interacting.current = true

    const move = (ev: PointerEvent) => {
      const pt = toBoard(ev.clientX, ev.clientY)
      const at = { x: ev.clientX - stageRect.left + 16, y: ev.clientY - stageRect.top + 16 }
      let patch: Partial<CropSettings>
      if (mode.kind === 'move') {
        const r = dragOffset(start, W, H, a.w, a.h, (ev.clientX - x0) / kk, (ev.clientY - y0) / kk, 6 / kk, {
          shift: ev.shiftKey,
          alt: ev.altKey
        })
        patch = r.patch
        guides.current = r.guides
      } else if (mode.kind === 'scale') {
        const pivot = ev.altKey ? { x: p0.cx, y: p0.cy } : cs[(mode.corner + 2) % 4]
        const from = cs[mode.corner]
        const dx = from.x - pivot.x
        const dy = from.y - pivot.y
        const ratio = ((pt.x - pivot.x) * dx + (pt.y - pivot.y) * dy) / (dx * dx + dy * dy)
        const zoom = snapZoom(start.zoom * ratio, false)
        patch = zoomAbout(start, W, H, a.w, a.h, zoom, pivot)
        setReadout({ ...at, text: `${Math.round(zoom * 100)}%` })
      } else {
        const ang = Math.atan2(pt.y - p0.cy, pt.x - p0.cx)
        const deg = snapAngle(start.rotation + ((ang - a0) * 180) / Math.PI, ev.shiftKey, ev.altKey)
        patch = rotateAbout(start, W, H, a.w, a.h, deg)
        setReadout({ ...at, text: `${Math.round(patch.rotation! * 10) / 10}°` })
      }
      useStore.getState().editAsset(a.name, patch)
    }
    const up = () => {
      dragging.current = false
      endInteraction()
      guides.current = NO_GUIDES
      setReadout(null)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      drawRef.current()
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
    drawRef.current()
  }

  const resetTransform = () => {
    const { asset: a } = live.current
    if (a) useStore.getState().resetKeys(['zoom', 'offsetX', 'offsetY', 'rotation'], [a.name])
  }

  const setHover = (v: boolean) => {
    hover.current = v
    drawRef.current()
  }

  return (
    <div className="loupe">
      <div
        className="stage"
        ref={stage}
        style={{ cursor }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerEnter={() => setHover(true)}
        onPointerLeave={() => setHover(false)}
        onDoubleClick={resetTransform}
      >
        <canvas ref={canvas} style={{ width: size.w, height: size.h }} />
        {asset && (
          <div className="board-label" style={{ left: bx, top: by - 26, width: board.width * k }}>
            <span>{asset.name}</span>
            <span className="muted">
              {index + 1} / {count}
            </span>
          </div>
        )}
        {readout && (
          <div className="readout" style={{ left: readout.x, top: readout.y }}>
            {readout.text}
          </div>
        )}
        {!focus && <div className="empty-hint">Nothing selected</div>}
      </div>
      {asset && isVideo && asset.duration > 0 && (
        <div className="transport" style={{ left: bx, width: board.width * k, top: by + board.height * k + 20 }}>
          <button className={'icon-btn' + (queued ? ' loading' : '')} onClick={toggle} title="Play / Pause (Space)">
            <Icon name={playing || queued ? 'pause' : 'play'} />
          </button>
          <Timeline
            duration={asset.duration}
            start={clip.start}
            end={clip.end}
            time={time}
            onSeek={seek}
            aspect={board.width / board.height}
            onPreview={preview}
            onTrim={(start, end) => setTrimDraft({ start, end })}
            onTrimEnd={(start, end) => {
              setTrimDraft(null)
              useStore.getState().setClip(asset.name, { start, end: end >= asset.duration - 0.01 ? null : end })
              // Keep the view's frame unless it's now outside the trimmed range.
              if (video && (video.currentTime < start || video.currentTime > end)) seek(start)
            }}
          />
          <span className="time">
            {fmtTime(Math.max(0, time - clip.start))}
            <span className="muted"> / {fmtTime(clip.end - clip.start)}</span>
          </span>
        </div>
      )}
    </div>
  )
}

/**
 * Downscaled copy of `src` with a long edge of at least `need` pixels (in 512px steps, capped at
 * the source). Built asynchronously and only ever grown, so zooming in sharpens it and zooming
 * out doesn't churn. Returns null while `floor` (e.g. the thumbnail) already covers what's needed.
 */
function useProxy(src: Blob | null, sw: number, sh: number, need: number, floor: number): ImageBitmap | null {
  const [proxy, setProxy] = useState<{ src: Blob; edge: number; bitmap: ImageBitmap } | null>(null)
  const long = Math.max(sw, sh)
  const edge = Math.min(long, Math.ceil(need / 512) * 512)
  const enough = edge <= floor
  const have = proxy && proxy.src === src ? proxy : null
  useEffect(() => {
    if (!src || !long || enough || (have && have.edge >= edge)) return
    let alive = true
    const s = edge / long
    createImageBitmap(src, {
      resizeWidth: Math.max(1, Math.round(sw * s)),
      resizeHeight: Math.max(1, Math.round(sh * s)),
      resizeQuality: 'high'
    })
      .then((bitmap) => {
        // The replaced proxy is left to GC: a draw already in flight may still be using it.
        if (alive) setProxy({ src, edge, bitmap })
        else bitmap.close()
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [src, sw, sh, edge, enough, have?.edge])
  return enough ? null : have?.bitmap ?? null
}

type View = { k: number; bx: number; by: number }

/** Eases toward the target view; jumps when `instantKey` changes (resize, new asset). */
function useEased(target: View, instantKey: string): View {
  const [view, setView] = useState(target)
  const current = useRef(view)
  current.current = view
  const lastKey = useRef(instantKey)
  const { k, bx, by } = target
  useEffect(() => {
    const from = current.current
    if (from.k === k && from.bx === bx && from.by === by) return
    if (lastKey.current !== instantKey) {
      lastKey.current = instantKey
      return setView({ k, bx, by })
    }
    const t0 = performance.now()
    let raf = 0
    const step = () => {
      const t = Math.min(1, (performance.now() - t0) / 220)
      const e = 1 - Math.pow(1 - t, 3)
      setView({ k: from.k + (k - from.k) * e, bx: from.bx + (bx - from.bx) * e, by: from.by + (by - from.by) * e })
      if (t < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [k, bx, by, instantKey])
  return view
}

function Timeline({
  duration,
  start,
  end,
  time,
  aspect,
  onSeek,
  onPreview,
  onTrim,
  onTrimEnd
}: {
  duration: number
  start: number
  end: number
  time: number
  aspect: number
  onSeek: (t: number) => void
  onPreview: (canvas: HTMLCanvasElement, t: number) => void
  onTrim: (start: number, end: number) => void
  onTrimEnd: (start: number, end: number) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [scrub, setScrub] = useState<number | null>(null)
  // Preview box: the artboard's shape, about 150px on its long side.
  const pw = Math.round(aspect >= 1 ? 150 : 150 * aspect)
  const ph = Math.round(aspect >= 1 ? 150 / aspect : 150)
  const dpr = window.devicePixelRatio || 1
  useEffect(() => {
    if (scrub != null && canvas.current) onPreview(canvas.current, scrub)
  }, [scrub])
  const pct = (t: number) => `${(t / duration) * 100}%`
  const at = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect()
    return Math.min(duration, Math.max(0, ((clientX - r.left) / r.width) * duration))
  }
  const drag = (e: React.PointerEvent, kind: 'seek' | 'in' | 'out') => {
    e.stopPropagation()
    const el = e.currentTarget as HTMLElement
    el.setPointerCapture(e.pointerId)
    let range = { start, end }
    const apply = (x: number) => {
      const t = at(x)
      if (kind === 'seek') return onSeek(Math.min(end, Math.max(start, t)))
      if (kind === 'in') {
        range = { start: Math.max(0, Math.min(t, end - 0.1)), end }
        setScrub(range.start)
      } else {
        range = { start, end: Math.min(duration, Math.max(t, start + 0.1)) }
        // Last frame that's kept.
        setScrub(Math.max(range.start, range.end - 0.04))
      }
      onTrim(range.start, range.end)
    }
    apply(e.clientX)
    const move = (ev: PointerEvent) => apply(ev.clientX)
    const up = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      if (kind === 'seek') return
      setScrub(null)
      onTrimEnd(range.start, range.end)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
  }
  return (
    <div className="timeline" ref={ref} onPointerDown={(e) => drag(e, 'seek')}>
      <div className="tl-track" />
      <div className="tl-range" style={{ left: pct(start), width: pct(end - start) }} />
      <div className="tl-head" style={{ left: pct(time) }} />
      <div className="tl-handle in" style={{ left: pct(start) }} onPointerDown={(e) => drag(e, 'in')} title="Trim start" />
      <div className="tl-handle out" style={{ left: pct(end) }} onPointerDown={(e) => drag(e, 'out')} title="Trim end" />
      {scrub != null && (
        <div className="tl-preview" style={{ left: pct(scrub) }}>
          <canvas ref={canvas} width={Math.round(pw * dpr)} height={Math.round(ph * dpr)} style={{ width: pw, height: ph }} />
          <span>{fmtTime(scrub)}</span>
        </div>
      )}
    </div>
  )
}
