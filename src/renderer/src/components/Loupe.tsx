import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { bounds, computeLayout, corners, drawFrame, fromLocal, quarterTurns, resolveSettings, toLocal, type Point } from '@shared/layout'
import type { CropSettings } from '@shared/types'
import { dragOffset, NO_GUIDES, rotateAbout, snapAngle, snapScale, snapZoom, withPivot, zoomAbout, ZOOM_MAX, ZOOM_MIN, type Guides } from '../interact'
import { combo, MOD } from '../keys'
import { api, loadStill, mediaUrl } from '../media'
import { assetMenu } from '../menus'
import { crossfade, fly, settledRect, snapshot } from '../motion'
import { clipFor, useBoard, useStore } from '../store'
import { Filmstrip } from './Filmstrip'
import { fmtTime, Icon, Slider } from './ui'

// Board placement inside the stage. The player and filmstrip float over the bottom of the stage,
// in a reserved band that's the same for images and videos, so the board never jumps.
const MARGIN_X = 48
const MARGIN_TOP = 40
/** Matches the CSS: .player height, .film-row heights, and the gaps around them. */
const PLAYER_H = 44
const FILM_H = 64
const GAP = 12
const HANDLE = 4.5
const HIT_HANDLE = 10
/** Distance (screen px) from an edge that grabs it for a one-axis stretch. */
const HIT_EDGE = 6
const HIT_ROTATE = 30
const ACCENT = '#6e9bff'
const GUIDE = '#ff4f8b'

/** `handle` is the grabbed corner or edge midpoint, in local (0..1) media coordinates. */
type Mode = { kind: 'none' } | { kind: 'move' } | { kind: 'scale'; handle: Point } | { kind: 'rotate' }

// Edge midpoints: top, right, bottom, left.
const EDGE_MID = [
  { x: 0.5, y: 0 },
  { x: 1, y: 0.5 },
  { x: 0.5, y: 1 },
  { x: 0, y: 0.5 }
]
const resizeCursor = (deg: number) => RESIZE[Math.round((((deg % 180) + 180) % 180) / 45) % 4]

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
  // While the playhead is dragged: where the pointer has it, shown at once whatever the decoder is
  // doing. Frames come from the scrub proxy when it's ready, drawn in place of the video.
  const [scrubTime, setScrubTime] = useState<number | null>(null)
  const [proxyVideo, setProxyVideo] = useState<HTMLVideoElement | null>(null)
  const scrubSrc = useRef<HTMLVideoElement | null>(null)
  const scrubbing = useRef<{ resume: boolean } | null>(null)
  const [cursor, setCursor] = useState('default')
  const [readout, setReadout] = useState<{ x: number; y: number; text: string } | null>(null)
  const picking = useStore((s) => s.picking)
  const volume = useStore((s) => s.volume)
  // Figma-style: handles, the overflow ghost and the handle-revealing framing appear only while the
  // media is selected. Click it to select; click empty space (or Esc) to deselect.
  const [selected, setSelected] = useState(false)
  useEffect(() => setSelected(false), [focus])
  const hoverMedia = useRef(false)
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

  // View: the board stays centred. While selected it zooms out enough that the media's corners
  // (and so the handles) are on screen. Held still while interacting, then eased to the new framing.
  const interacting = useRef(false)
  const [, settle] = useState(0)
  const target = useRef({ k: 1, bx: 0, by: 0 })
  const availW = size.w - MARGIN_X * 2
  const reserved = GAP + FILM_H + GAP + PLAYER_H + GAP * 2
  const availH = size.h - MARGIN_TOP - reserved
  if (!interacting.current) {
    const fitK = Math.max(0.01, Math.min(availW / board.width, availH / board.height))
    let k = fitK
    if (asset?.w && selected) {
      const b = bounds(computeLayout(board.width, board.height, asset.w, asset.h, settings))
      const ex = Math.max(board.width / 2, board.width / 2 - b.x, b.x + b.w - board.width / 2)
      const ey = Math.max(board.height / 2, board.height / 2 - b.y, b.y + b.h - board.height / 2)
      k = Math.max(fitK * 0.45, Math.min(fitK, availW / 2 / ex, availH / 2 / ey))
    }
    target.current = { k, bx: (size.w - board.width * k) / 2, by: MARGIN_TOP + (availH - board.height * k) / 2 }
  }
  // Camera: Fit (above: auto-framed, eased) or Manual, where you've scrolled, pinched or panned to.
  // A new asset goes back to Fit; in Manual, selecting no longer moves the view.
  const [manual, setManualState] = useState<View | null>(null)
  const manualRef = useRef<View | null>(null)
  const setManual = (v: View | null) => {
    manualRef.current = v
    setManualState(v)
  }
  useEffect(() => setManual(null), [focus])
  // Resizing in Manual keeps the same point centred.
  const lastSize = useRef(size)
  useEffect(() => {
    const m = manualRef.current
    if (m && lastSize.current.w) setManual({ k: m.k, bx: m.bx + (size.w - lastSize.current.w) / 2, by: m.by + (size.h - lastSize.current.h) / 2 })
    lastSize.current = size
  }, [size.w, size.h])
  const { k, bx, by } = useEased(target.current, `${size.w}x${size.h}/${asset?.name}/${board.id}`, manual)
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

  // Zoom transitions: the grid thumbnail flies up into the board on enter and back down on exit;
  // stepping between assets crossfades. While the flyer is in the air the canvas stays hidden.
  const [entering, setEntering] = useState(false)
  const entered = useRef(false)
  useLayoutEffect(() => {
    if (entered.current || !size.w || !stage.current) return
    entered.current = true
    if (!asset?.w) return
    const cell = document.querySelector<HTMLCanvasElement>(`.cell[data-name="${CSS.escape(asset.name)}"] canvas[data-ready]`)
    const host = stage.current.closest<HTMLElement>('.content')
    if (!cell || !host) return
    const t = target.current
    const s0 = stage.current.getBoundingClientRect()
    const to = new DOMRect(s0.left + t.bx, s0.top + t.by, board.width * t.k, board.height * t.k)
    setEntering(true)
    fly(host, snapshot(cell), cell.getBoundingClientRect(), to).then((dismiss) => {
      setEntering(false)
      requestAnimationFrame(dismiss)
    })
  })
  useLayoutEffect(
    () => () => {
      // Leaving: capture the board as drawn, then land it on its grid cell once the grid is back.
      const { asset: a, board: b, k: kk, bx: x, by: y } = live.current
      const c = canvas.current
      const host = stage.current?.closest<HTMLElement>('.content')
      if (!a || !c || !host || !c.width) return
      const dpr = window.devicePixelRatio || 1
      const s0 = stage.current!.getBoundingClientRect()
      const from = new DOMRect(s0.left + x, s0.top + y, b.width * kk, b.height * kk)
      const still = snapshot(c, x * dpr, y * dpr, b.width * kk * dpr, b.height * kk * dpr)
      requestAnimationFrame(() =>
        requestAnimationFrame(async () => {
          if (useStore.getState().view !== 'grid') return
          const cell = document.querySelector<HTMLCanvasElement>(`.cell[data-name="${CSS.escape(a.name)}"] canvas`)
          if (!cell) return
          cell.style.opacity = '0'
          // The grid is still growing back from its receded scale; aim for where the cell settles.
          const dismiss = await fly(host, still, from, settledRect(cell, cell.closest<HTMLElement>('.grid-scroll')!), 300)
          cell.style.opacity = ''
          dismiss()
        })
      )
    },
    []
  )
  const shown = useRef(asset?.name)
  useLayoutEffect(() => {
    if (shown.current && asset?.name !== shown.current && canvas.current) crossfade(canvas.current)
    shown.current = asset?.name
  }, [asset?.name])

  // Latest render state for event handlers, so they never act on a stale closure.
  const live = useRef({ board, settings, asset, k, bx, by, selected })
  live.current = { board, settings, asset, k, bx, by, selected }

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

  // Scrub proxy: requested once a video has been open for a moment (not for every one flicked
  // past), built in the background, then loaded into a hidden muted video ready for seeking.
  useEffect(() => {
    setProxyVideo(null)
    scrubSrc.current = null
    if (!asset || asset.kind !== 'video' || !asset.w) return
    let alive = true
    let v: HTMLVideoElement | null = null
    const timer = setTimeout(() => {
      api
        .scrubProxy(asset.path, asset.w, asset.h, asset.color)
        .then((path) => {
          if (!alive) return
          v = document.createElement('video')
          v.muted = true
          v.preload = 'auto'
          v.crossOrigin = 'anonymous'
          v.src = mediaUrl(path)
          const pv = v
          pv.addEventListener('loadeddata', () => alive && setProxyVideo(pv), { once: true })
        })
        .catch(() => {})
    }, 500)
    return () => {
      alive = false
      clearTimeout(timer)
      if (v) {
        v.removeAttribute('src')
        v.load()
      }
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
    const resized = c.width !== pw || c.height !== ph
    if (resized) {
      c.width = pw
      c.height = ph
    }
    const useExact = exact && exactProxy && video?.paused && Math.abs(exact.t - video.currentTime) < 0.001
    // Mid-seek, a video has no frame to give. Keep what's on screen (it repaints on 'seeked')
    // rather than flash a stand-in like the poster, which made scrubbing flicker.
    const want = scrubSrc.current ?? (useExact ? null : video)
    if (want && want.seeking && want.readyState < 2 && !resized) return
    const ctx = c.getContext('2d')!
    ctx.clearRect(0, 0, pw, ph)
    const scrubFrame = scrubSrc.current && scrubSrc.current.readyState >= 2 ? scrubSrc.current : null
    const src: CanvasImageSource | null =
      scrubFrame ?? (useExact ? exactProxy : video && video.readyState >= 2 ? video : stillProxy ?? asset.thumb)
    const kk = k * dpr
    const ox = bx * dpr
    const oy = by * dpr
    const W = board.width
    const H = board.height
    const p = asset.w ? computeLayout(W, H, asset.w, asset.h, settings) : null
    const active = (selected || dragging.current) && !picking

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

    // Hovering an unselected image: a thin outline, like Figma.
    if (p && !active && hoverMedia.current && !picking) {
      const pts = corners(p).map((pt) => ({ x: ox + pt.x * kk, y: oy + pt.y * kk }))
      ctx.save()
      ctx.lineWidth = dpr
      ctx.strokeStyle = ACCENT
      ctx.beginPath()
      pts.forEach((pt, i) => (i ? ctx.lineTo(pt.x, pt.y) : ctx.moveTo(pt.x, pt.y)))
      ctx.closePath()
      ctx.stroke()
      ctx.restore()
    }

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
  }, [asset, size, video, stillProxy, exact, exactProxy, k, bx, by, board, settings, picking, selected])

  const drawRef = useRef(draw)
  drawRef.current = draw
  useEffect(draw)

  // Preview audio: silent if the export is muted; otherwise the global preview volume.
  useEffect(() => {
    if (!video) return
    video.volume = volume
    video.muted = settings.mute || volume === 0
  }, [video, settings.mute, volume])

  useEffect(() => {
    if (!selected) return
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || useStore.getState().picking || (e.target as HTMLElement).closest?.('input, textarea')) return
      e.preventDefault()
      e.stopImmediatePropagation()
      setSelected(false)
    }
    // Capture phase, so Esc deselects before the app-wide Esc (back to grid) sees it.
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [selected])

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
      // Show each frame as it arrives, then chase the newest target if the pointer has moved on.
      if (pendingSeek.current != null) {
        drawRef.current()
        video.currentTime = pendingSeek.current
        pendingSeek.current = null
        return
      }
      // The real frame has landed: stop standing in with the proxy.
      if (!scrubbing.current) scrubSrc.current = null
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

  // Playhead drags. Playback pauses for the drag (and resumes after). With a proxy, every move
  // seeks the proxy (newest target wins) and its frames are drawn; the real video seeks once, to
  // where the drag ends, and takes over when that frame is ready.
  const proxyPending = useRef<number | null>(null)
  useEffect(() => {
    if (!proxyVideo) return
    const onSeeked = () => {
      if (scrubSrc.current === proxyVideo) drawRef.current()
      if (proxyPending.current != null) {
        proxyVideo.currentTime = proxyPending.current
        proxyPending.current = null
      }
    }
    proxyVideo.addEventListener('seeked', onSeeked)
    return () => proxyVideo.removeEventListener('seeked', onSeeked)
  }, [proxyVideo])
  const scrubStart = () => {
    scrubbing.current = { resume: !!video && !video.paused }
    video?.pause()
  }
  const scrubTo = (t: number) => {
    setScrubTime(t)
    if (!proxyVideo) return seek(t)
    scrubSrc.current = proxyVideo
    if (proxyVideo.seeking) proxyPending.current = t
    else proxyVideo.currentTime = t
  }
  const scrubEnd = (t: number) => {
    const resume = scrubbing.current?.resume
    scrubbing.current = null
    setScrubTime(null)
    setTime(t)
    seek(t)
    if (resume) video?.play().catch(() => {})
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
      v.src = proxyVideo?.src ?? mediaUrl(asset.path)
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
    const { asset: a, board: b, settings: s, k: kk, selected: sel } = live.current
    if (!a?.w) return { mode: { kind: 'none' }, cursor: 'default' }
    const p = computeLayout(b.width, b.height, a.w, a.h, s)
    const cs = corners(p)
    const dist = cs.map((c) => Math.hypot(c.x - pt.x, c.y - pt.y) * kk)
    const i = dist.indexOf(Math.min(...dist))
    // The resize cursor points from the centre through the grabbed handle.
    const grab = (handle: Point) => {
      const at = fromLocal(p, handle)
      const ang = (Math.atan2(at.y - p.cy, at.x - p.cx) * 180) / Math.PI
      return { mode: { kind: 'scale', handle } as Mode, cursor: resizeCursor(ang) }
    }
    if (sel && dist[i] <= HIT_HANDLE) return grab({ x: i === 1 || i === 2 ? 1 : 0, y: i >= 2 ? 1 : 0 })
    const l = toLocal(p, pt)
    // Anywhere along an edge grabs it, like an invisible handle at its midpoint.
    if (sel) {
      const gap = [Math.abs(l.y) * p.h, Math.abs(l.x - 1) * p.w, Math.abs(l.y - 1) * p.h, Math.abs(l.x) * p.w]
      const along = [l.x, l.y, l.x, l.y]
      let edge = -1
      let best = HIT_EDGE
      gap.forEach((g, j) => {
        if (g * kk <= best && along[j] >= 0 && along[j] <= 1) {
          edge = j
          best = g * kk
        }
      })
      if (edge >= 0) return grab(EDGE_MID[edge])
    }
    const onMedia = l.x >= 0 && l.x <= 1 && l.y >= 0 && l.y <= 1
    // Unselected, only the visible (in-board) part is clickable, like clipped content in Figma.
    // Selected, the ghosted overflow is part of it too.
    const inside = onMedia && (sel || (pt.x >= 0 && pt.x <= b.width && pt.y >= 0 && pt.y <= b.height))
    if (sel && !onMedia && dist[i] <= HIT_ROTATE) return { mode: { kind: 'rotate' }, cursor: ROTATE_CURSOR }
    if (inside) return { mode: { kind: 'move' }, cursor: sel ? 'move' : 'default' }
    return { mode: { kind: 'none' }, cursor: 'default' }
  }

  // Camera moves, in stage pixels. They read and write manualRef directly so a burst of wheel
  // events between renders compounds correctly.
  const current = (): View => manualRef.current ?? { k: live.current.k, bx: live.current.bx, by: live.current.by }
  const zoomView = (factor: number, sx: number, sy: number) => {
    const v = current()
    const k1 = Math.min(40, Math.max(0.02, v.k * factor))
    const px = (sx - v.bx) / v.k
    const py = (sy - v.by) / v.k
    setManual({ k: k1, bx: sx - px * k1, by: sy - py * k1 })
  }
  const panView = (dx: number, dy: number) => {
    const v = current()
    setManual({ k: v.k, bx: v.bx + dx, by: v.by + dy })
  }
  const fitView = () => setManual(null)
  const actualPixels = () => {
    const dpr = window.devicePixelRatio || 1
    zoomView(1 / dpr / current().k, size.w / 2, size.h / 2)
  }

  // Trackpads: pinch zooms (Chromium reports it as a wheel with ctrlKey), two fingers pan. A mouse
  // wheel zooms. Mouse notches come in whole multiples of 120 with no sideways component; once a
  // gesture looks like a trackpad it stays one, so momentum never flips into zooming.
  // Alt+scroll still scales the image itself.
  useEffect(() => {
    const el = stage.current!
    let trackpadUntil = 0
    let wheelIdle: ReturnType<typeof setTimeout> | undefined
    const wheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = el.getBoundingClientRect()
      const sx = e.clientX - r.left
      const sy = e.clientY - r.top
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? r.height : 1
      const dx = e.deltaX * unit
      const dy = e.deltaY * unit
      const now = performance.now()
      if (e.altKey) {
        const { asset: a, board: b, settings: st } = live.current
        if (!a?.w) return
        interacting.current = true
        clearTimeout(wheelIdle)
        wheelIdle = setTimeout(endInteraction, 500)
        const zoom = snapZoom(st.zoom * Math.exp(-dy * 0.0015), true)
        useStore.getState().editAsset(a.name, zoomAbout(st, b.width, b.height, a.w, a.h, zoom, toBoard(e.clientX, e.clientY)))
        return
      }
      const legacy = (e as WheelEvent & { wheelDeltaY?: number }).wheelDeltaY ?? 0
      const notch = e.deltaMode !== 0 || (e.deltaX === 0 && legacy !== 0 && legacy % 120 === 0)
      if (e.ctrlKey || e.metaKey) zoomView(Math.exp(-dy * (notch ? 0.0015 : 0.01)), sx, sy)
      else if (notch && now > trackpadUntil) zoomView(Math.exp(-dy * 0.0015), sx, sy)
      else {
        trackpadUntil = now + 300
        panView(-dx, -dy)
      }
    }
    el.addEventListener('wheel', wheel, { passive: false })
    return () => {
      clearTimeout(wheelIdle)
      el.removeEventListener('wheel', wheel)
    }
  }, [])

  // ⌘/Ctrl+0 fits; ⌘/Ctrl +/− zoom about the centre.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || (e.target as HTMLElement).closest?.('input, textarea')) return
      if (e.key === '0') fitView()
      else if (e.key === '=' || e.key === '+') zoomView(1.25, size.w / 2, size.h / 2)
      else if (e.key === '-') zoomView(0.8, size.w / 2, size.h / 2)
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  })

  /** Drags the view; a click that never moves calls `onClick` instead. */
  const startPan = (e: React.PointerEvent, onClick?: () => void) => {
    const el = e.currentTarget as HTMLElement
    el.setPointerCapture(e.pointerId)
    let last = { x: e.clientX, y: e.clientY }
    let moved = false
    const move = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 3) return
      if (!moved) setCursor('grabbing')
      moved = true
      panView(ev.clientX - last.x, ev.clientY - last.y)
      last = { x: ev.clientX, y: ev.clientY }
    }
    const up = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      if (moved) setCursor('default')
      else onClick?.()
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (dragging.current) return
    const hit = hitTest(toBoard(e.clientX, e.clientY))
    const over = hit.mode.kind === 'move'
    if (over !== hoverMedia.current) {
      hoverMedia.current = over
      drawRef.current()
    }
    if (hit.cursor !== cursor) setCursor(hit.cursor)
  }

  const onPointerDown = (e: React.PointerEvent) => {
    const { asset: a, board: b, settings: start, k: kk } = live.current
    // Middle button pans from anywhere.
    if (e.button === 1) {
      e.preventDefault()
      return startPan(e)
    }
    if (e.button !== 0 || !a?.w) return
    const W = b.width
    const H = b.height
    const pt0 = toBoard(e.clientX, e.clientY)
    const { mode } = hitTest(pt0)
    // Empty space: drag to pan, click to deselect.
    if (mode.kind === 'none') return startPan(e, () => setSelected(false))
    // Editing defaults (the asset is on screen but not selected): clicking it selects it again.
    const store = useStore.getState()
    if (!store.selection.includes(a.name)) store.setSelection([a.name])
    const el = e.currentTarget as HTMLElement
    el.setPointerCapture(e.pointerId)
    if (!live.current.selected) setSelected(true)
    const p0 = computeLayout(W, H, a.w, a.h, start)
    const a0 = Math.atan2(pt0.y - p0.cy, pt0.x - p0.cx)
    const x0 = e.clientX
    const y0 = e.clientY
    const stageRect = stage.current!.getBoundingClientRect()
    dragging.current = true
    interacting.current = true

    // Every move is computed from the drag's start, so modifiers can come and go freely.
    type DragInput = Pick<PointerEvent, 'clientX' | 'clientY' | 'shiftKey' | 'altKey' | 'ctrlKey' | 'metaKey'>
    let last: DragInput = e.nativeEvent
    const move = (ev: DragInput) => {
      last = ev
      const pt = toBoard(ev.clientX, ev.clientY)
      const at = { x: ev.clientX - stageRect.left + 16, y: ev.clientY - stageRect.top + 16 }
      let patch: Partial<CropSettings>
      if (mode.kind === 'move') {
        const r = dragOffset(start, W, H, a.w, a.h, (ev.clientX - x0) / kk, (ev.clientY - y0) / kk, 6 / kk, {
          shift: ev.shiftKey,
          alt: ev.altKey || ev.metaKey || ev.ctrlKey
        })
        patch = r.patch
        guides.current = r.guides
      } else if (mode.kind === 'scale') {
        // Scales about the opposite corner or edge (Alt: the centre), keeping the aspect ratio;
        // Shift stretches instead, along whichever axes the handle moves. Edges and the centre
        // snap to the board's edges and centre; ⌘/Ctrl turns snapping off.
        const h = mode.handle
        const pivotL = ev.altKey ? { x: 0.5, y: 0.5 } : { x: 1 - h.x, y: 1 - h.y }
        const pivot = fromLocal(p0, pivotL)
        const free = ev.metaKey || ev.ctrlKey
        guides.current = NO_GUIDES
        if (!ev.shiftKey) {
          const from = fromLocal(p0, h)
          const dx = from.x - pivot.x
          const dy = from.y - pivot.y
          const ratio = Math.max(ZOOM_MIN / start.zoom, ((pt.x - pivot.x) * dx + (pt.y - pivot.y) * dy) / (dx * dx + dy * dy))
          const snapped = free ? null : snapScale(W, H, bounds(p0), pivot, ratio, 6 / kk, { x: true, y: true })
          if (snapped) guides.current = snapped.guides
          const zoom = Math.min(ZOOM_MAX, snapped ? start.zoom * snapped.ratio : snapZoom(start.zoom * ratio, free))
          // Each branch writes every scale key, so toggling Shift mid-drag swaps cleanly.
          patch = withPivot(start, W, H, a.w, a.h, { zoom, scaleX: start.scaleX, scaleY: start.scaleY }, pivot)
          setReadout({ ...at, text: `${Math.round(zoom * 100)}%` })
        } else {
          const l = toLocal(p0, pt)
          const r = {
            x: h.x === 0.5 ? 1 : Math.max(0.02, (l.x - pivotL.x) / (h.x - pivotL.x)),
            y: h.y === 0.5 ? 1 : Math.max(0.02, (l.y - pivotL.y) / (h.y - pivotL.y))
          }
          // At a right angle each media axis runs along a board axis, so each snaps on its own.
          const q = quarterTurns(start.rotation)
          if (q != null && !free) {
            const box = bounds(p0)
            for (const axis of ['x', 'y'] as const) {
              if ((axis === 'x' ? h.x : h.y) === 0.5) continue
              const alongX = (axis === 'x') === (q % 2 === 0)
              const snapped = snapScale(W, H, box, pivot, r[axis], 6 / kk, { x: alongX, y: !alongX })
              if (!snapped) continue
              r[axis] = snapped.ratio
              guides.current = { x: [...guides.current.x, ...snapped.guides.x], y: [...guides.current.y, ...snapped.guides.y] }
            }
          }
          const scaleX = start.scaleX * r.x
          const scaleY = start.scaleY * r.y
          patch = withPivot(start, W, H, a.w, a.h, { zoom: start.zoom, scaleX, scaleY }, pivot)
          const parts = [h.x !== 0.5 && `W ${Math.round(scaleX * 100)}%`, h.y !== 0.5 && `H ${Math.round(scaleY * 100)}%`]
          setReadout({ ...at, text: parts.filter(Boolean).join('  ') })
        }
      } else {
        const ang = Math.atan2(pt.y - p0.cy, pt.x - p0.cx)
        const deg = snapAngle(start.rotation + ((ang - a0) * 180) / Math.PI, ev.shiftKey, ev.altKey || ev.metaKey || ev.ctrlKey)
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
      window.removeEventListener('keydown', modifiers, true)
      window.removeEventListener('keyup', modifiers, true)
      drawRef.current()
    }
    // Pressing or releasing a modifier re-applies the whole drag at once, without waiting for
    // the pointer to move.
    const modifiers = (ke: KeyboardEvent) => {
      if (!['Shift', 'Alt', 'Control', 'Meta'].includes(ke.key)) return
      ke.preventDefault()
      move({ clientX: last.clientX, clientY: last.clientY, shiftKey: ke.shiftKey, altKey: ke.altKey, ctrlKey: ke.ctrlKey, metaKey: ke.metaKey })
      drawRef.current()
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
    window.addEventListener('keydown', modifiers, true)
    window.addEventListener('keyup', modifiers, true)
    drawRef.current()
  }

  // Double-click the image to reset its transform; double-click empty space to go back to the grid.
  const onDoubleClick = (e: React.MouseEvent) => {
    const { asset: a } = live.current
    if (hitTest(toBoard(e.clientX, e.clientY)).mode.kind === 'none') useStore.getState().setView('grid')
    else if (a) useStore.getState().resetKeys(['zoom', 'scaleX', 'scaleY', 'offsetX', 'offsetY', 'rotation'], [a.name])
  }

  return (
    <div className="loupe">
      <div
        className="stage"
        ref={stage}
        style={{ cursor }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerLeave={() => {
          hoverMedia.current = false
          drawRef.current()
        }}
        onDoubleClick={onDoubleClick}
        onContextMenu={(e) => {
          e.preventDefault()
          if (asset) assetMenu(asset.name, asset.path, { x: e.clientX, y: e.clientY }, true)
        }}
      >
        <canvas ref={canvas} style={{ width: size.w, height: size.h, opacity: entering ? 0 : 1 }} />
        {asset && (
          <button
            className="zoom-chip"
            title={manual ? `Fit to view (${combo(MOD, '0')})` : 'Actual pixels'}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => (manual ? fitView() : actualPixels())}
          >
            {manual ? `${Math.round(k * dpr * 100)}%` : 'Fit'}
          </button>
        )}
        {readout && (
          <div className="readout" style={{ left: readout.x, top: readout.y }}>
            {readout.text}
          </div>
        )}
        {!focus && <div className="empty-hint">Nothing selected</div>}
      </div>
      <div className="loupe-fade" />
      {/* Floating over the reserved band at the bottom of the stage: the player, then the filmstrip. */}
      <div className="loupe-overlay">
        {asset && isVideo && asset.duration > 0 && (
          <div className="player">
            {/* Both glyphs stay mounted and crossfade, so the button never pops. */}
            <button
              className={'play' + (playing || queued ? ' playing' : '') + (queued ? ' loading' : '')}
              onClick={toggle}
              title="Play / Pause (Space)"
            >
              <span className="glyph play-glyph">
                <Icon name="play" size={14} />
              </span>
              <span className="glyph pause-glyph">
                <Icon name="pause" size={14} />
              </span>
            </button>
            <span className="time">{fmtTime(Math.max(0, (scrubTime ?? time) - clip.start))}</span>
            <Timeline
              duration={asset.duration}
              start={clip.start}
              end={clip.end}
              time={scrubTime ?? time}
              aspect={board.width / board.height}
              onScrubStart={scrubStart}
              onSeek={scrubTo}
              onScrubEnd={scrubEnd}
              onPreview={preview}
              onTrim={(start, end) => setTrimDraft({ start, end })}
              onTrimEnd={(start, end) => {
                setTrimDraft(null)
                useStore.getState().setClip(asset.name, { start, end: end >= asset.duration - 0.01 ? null : end })
                // Keep the view's frame unless it's now outside the trimmed range.
                if (video && (video.currentTime < start || video.currentTime > end)) seek(start)
              }}
            />
            <span className="time muted">{fmtTime(clip.end - clip.start)}</span>
            {asset.audio === false || settings.mute ? (
              <span className="icon-btn static" title={asset.audio === false ? 'No audio track' : 'Audio is muted for export'}>
                <Icon name="volumeOff" />
              </span>
            ) : (
              <Volume />
            )}
          </div>
        )}
        <div className="film-row">
          <span className="film-count">
            {index + 1}
            <span className="muted"> / {count}</span>
          </span>
          <button className="icon-btn" title="Previous (←)" disabled={index <= 0} onClick={() => useStore.getState().step(-1)}>
            <Icon name="prev" />
          </button>
          <Filmstrip />
          <button className="icon-btn" title="Next (→)" disabled={index >= count - 1} onClick={() => useStore.getState().step(1)}>
            <Icon name="next" />
          </button>
        </div>
      </div>
    </div>
  )
}

/** Preview volume: global, remembered. Clicking the speaker toggles mute. */
function Volume() {
  const volume = useStore((s) => s.volume)
  const { setVolume } = useStore.getState()
  return (
    <div className="volume">
      <button
        className="icon-btn"
        title={volume > 0 ? 'Mute preview' : 'Unmute preview'}
        onClick={() => setVolume(volume > 0 ? 0 : useStore.getState().lastVolume)}
      >
        <Icon name={volume === 0 ? 'volumeOff' : volume < 0.5 ? 'volumeLow' : 'volumeHigh'} />
      </button>
      <Slider value={volume} min={0} max={1} step={0.01} onChange={setVolume} />
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

/**
 * Eases toward the target view; jumps when `instantKey` changes (resize, new asset). While `hold`
 * is set it shows that instead (a manual camera), and eases back from it once released.
 */
function useEased(target: View, instantKey: string, hold: View | null): View {
  const [view, setView] = useState(target)
  const viewRef = useRef(view)
  viewRef.current = view
  const held = useRef<View | null>(null)
  if (hold) held.current = hold
  const lastKey = useRef(instantKey)
  const { k, bx, by } = target
  useLayoutEffect(() => {
    if (hold) return
    const from = held.current ?? viewRef.current
    held.current = null
    if (lastKey.current !== instantKey) {
      lastKey.current = instantKey
      return setView({ k, bx, by })
    }
    if (from.k === k && from.bx === bx && from.by === by) return setView({ k, bx, by })
    // Start from what was on screen (possibly the manual view) before this paint.
    setView(from)
    const t0 = performance.now()
    let raf = 0
    const step = () => {
      const t = Math.min(1, (performance.now() - t0) / 240)
      const e = 1 - Math.pow(1 - t, 3)
      setView({ k: from.k + (k - from.k) * e, bx: from.bx + (bx - from.bx) * e, by: from.by + (by - from.by) * e })
      if (t < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [k, bx, by, instantKey, hold === null])
  return hold ?? view
}

function Timeline({
  duration,
  start,
  end,
  time,
  aspect,
  onScrubStart,
  onSeek,
  onScrubEnd,
  onPreview,
  onTrim,
  onTrimEnd
}: {
  duration: number
  start: number
  end: number
  time: number
  aspect: number
  onScrubStart: () => void
  onSeek: (t: number) => void
  onScrubEnd: (t: number) => void
  onPreview: (canvas: HTMLCanvasElement, t: number) => void
  onTrim: (start: number, end: number) => void
  onTrimEnd: (start: number, end: number) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [scrub, setScrub] = useState<number | null>(null)
  const [hover, setHover] = useState<number | null>(null)
  const [active, setActive] = useState<'seek' | 'in' | 'out' | null>(null)
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
    if (e.button !== 0) return
    e.stopPropagation()
    const el = e.currentTarget as HTMLElement
    el.setPointerCapture(e.pointerId)
    setActive(kind)
    if (kind === 'seek') onScrubStart()
    let range = { start, end }
    let seekTo = time
    const apply = (x: number) => {
      const t = at(x)
      if (kind === 'seek') {
        seekTo = Math.min(end, Math.max(start, t))
        setHover(seekTo)
        return onSeek(seekTo)
      }
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
      el.removeEventListener('pointercancel', up)
      setActive(null)
      if (kind === 'seek') return onScrubEnd(seekTo)
      setScrub(null)
      onTrimEnd(range.start, range.end)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
  }
  // The hover bubble shows where a click would seek to (clamped to the kept range).
  const bubble = active === 'in' || active === 'out' ? null : hover
  return (
    <div
      className={'timeline' + (active ? ' active' : '')}
      onPointerDown={(e) => drag(e, 'seek')}
      onPointerMove={(e) => !active && setHover(Math.min(end, Math.max(start, at(e.clientX))))}
      onPointerLeave={() => !active && setHover(null)}
    >
      <div className="tl-body" ref={ref}>
        <div className="tl-rail">
          <div className="tl-range" style={{ left: pct(start), width: pct(end - start) }} />
          <div className="tl-played" style={{ left: pct(start), width: pct(Math.max(0, time - start)) }} />
        </div>
        <div className="tl-head" style={{ left: pct(time) }} />
        <div className={'tl-handle in' + (active === 'in' ? ' on' : '')} style={{ left: pct(start) }} onPointerDown={(e) => drag(e, 'in')} title="Trim start" />
        <div className={'tl-handle out' + (active === 'out' ? ' on' : '')} style={{ left: pct(end) }} onPointerDown={(e) => drag(e, 'out')} title="Trim end" />
        {bubble != null && (
          <div className="tl-bubble" style={{ left: pct(bubble) }}>
            {fmtTime(Math.max(0, bubble - start))}
          </div>
        )}
        {scrub != null && (
          <div className="tl-preview" style={{ left: pct(scrub) }}>
            <canvas ref={canvas} width={Math.round(pw * dpr)} height={Math.round(ph * dpr)} style={{ width: pw, height: ph }} />
            <span>{fmtTime(scrub)}</span>
          </div>
        )}
      </div>
    </div>
  )
}
