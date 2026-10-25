<script lang="ts">
  import { untrack } from 'svelte'
  import { bounds, computeLayout, corners, drawFrame, fromLocal, quarterTurns, resolveSettings, toLocal, type Point } from '@shared/layout'
  import type { CropSettings } from '@shared/types'
  import { fmtTime } from '../../lib/format'
  import { dragOffset, NO_GUIDES, rotateAbout, snapAngle, snapScale, snapZoom, withPivot, zoomAbout, ZOOM_MAX, ZOOM_MIN, type Guides } from './snapping'
  import { combo, MOD } from '../../lib/keys'
  import { api, loadStill, mediaUrl } from '../../state/loading'
  import { assetMenu } from '../menus'
  import { crossfade, fly, settledRect, snapshot } from '../../lib/motion'
  import { app, clipFor } from '../../state/app.svelte'
  import Icon from '../../ui/Icon.svelte'
  import { camera, type View } from './camera.svelte'
  import Filmstrip from './Filmstrip.svelte'
  import { bitmapProxy } from './proxy.svelte'
  import Timeline from './Timeline.svelte'
  import Volume from './Volume.svelte'

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
  const RESIZE = ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize']
  const resizeCursor = (deg: number) => RESIZE[Math.round((((deg % 180) + 180) % 180) / 45) % 4]
  const svgCursor = (svg: string, fallback: string) => `url("data:image/svg+xml,${encodeURIComponent(svg)}") 12 12, ${fallback}`
  const ROTATE_CURSOR = svgCursor(
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">' +
      '<g fill="none" stroke-linecap="round"><path d="M7 16.5A6.5 6.5 0 1 0 7.6 7.4" stroke="#000" stroke-width="4"/>' +
      '<path d="M7 16.5A6.5 6.5 0 1 0 7.6 7.4" stroke="#fff" stroke-width="1.8"/></g>' +
      '<path d="M4.2 4.6l5.6.6-3.1 4.7z" fill="#fff" stroke="#000" stroke-width="1"/></svg>',
    'crosshair'
  )

  const asset = $derived(app.asset(app.focus))
  // Position among what the grid shows (filtered, sorted, collapsed folders left out).
  const index = $derived(app.visible.findIndex((a) => a.name === app.focus))
  const count = $derived(app.visible.length)
  const board = $derived(app.board)

  let stage: HTMLDivElement
  let canvas: HTMLCanvasElement
  let stageW = $state(0)
  let stageH = $state(0)
  const size = $derived({ w: stageW, h: stageH })
  let still = $state.raw<Blob | null>(null)
  let video = $state.raw<HTMLVideoElement | null>(null)
  let playing = $state(false)
  let queued = $state(false)
  // The browser can't decode this video (ProRes, or HEVC without the platform's decoder): the
  // poster and the scrub proxy (made by ffmpeg) stand in, and export still works.
  let unplayable = $state(false)
  // Ends a gizmo drag still in progress if the view closes mid-drag.
  let endDrag: (() => void) | null = null
  $effect(() => () => endDrag?.())
  // Paused video frame decoded by ffmpeg, as export will see it. Chromium's own decode can be off
  // by several levels (badly so for full-range video), which would make colour matching misleading.
  let exact = $state.raw<{ t: number; jpeg: Blob } | null>(null)
  let time = $state(0)
  // While the playhead is dragged: where the pointer has it, shown at once whatever the decoder is
  // doing. Frames come from the scrub proxy when it's ready, drawn in place of the video.
  let scrubTime = $state<number | null>(null)
  let proxyVideo = $state.raw<HTMLVideoElement | null>(null)
  let scrubSrc: HTMLVideoElement | null = null
  let scrubbing: { resume: boolean } | null = null
  let cursor = $state('default')
  let readout = $state<{ x: number; y: number; text: string } | null>(null)
  // Figma-style: handles, the overflow ghost and the handle-revealing framing appear only while
  // the media is selected. Click it to select; click empty space (or Esc) to deselect. Another
  // asset starts deselected.
  let selected = $derived.by(() => {
    void app.focus
    return false
  })
  let hoverMedia = false
  let dragging = false
  let guides: Guides = NO_GUIDES

  const isVideo = $derived(asset?.kind === 'video')
  // The asset's identity, for effects that start over only when it's another file (not when, say,
  // its thumbnail arrives).
  const path = $derived(asset?.path)
  const mtime = $derived(asset?.mtime)
  const name = $derived(asset?.name)
  const sourceW = $derived(asset?.w ?? 0)
  const duration = $derived(asset?.duration ?? 0)
  const settings = $derived(asset ? resolveSettings(board, asset.name) : board.defaults)
  // While a trim handle is dragged its value lives here, and is saved once on release.
  let trimDraft = $state<{ start: number; end: number } | null>(null)
  const clip = $derived(asset && isVideo ? (trimDraft ?? clipFor(app.project, asset.name, asset.duration)) : { start: 0, end: 0 })

  // View: the board stays centred. While selected it zooms out enough that the media's corners
  // (and so the handles) are on screen. Held still while interacting, then eased to the new framing.
  let interacting = false
  let settled = $state(0)
  let held: View = { k: 1, bx: 0, by: 0 }
  const target = $derived.by((): View => {
    void settled
    if (interacting) return held
    const availW = size.w - MARGIN_X * 2
    const reserved = GAP + FILM_H + GAP + PLAYER_H + GAP * 2
    const availH = size.h - MARGIN_TOP - reserved
    const fitK = Math.max(0.01, Math.min(availW / board.width, availH / board.height))
    let k = fitK
    if (asset?.w && selected) {
      const b = bounds(computeLayout(board.width, board.height, asset.w, asset.h, settings))
      const ex = Math.max(board.width / 2, board.width / 2 - b.x, b.x + b.w - board.width / 2)
      const ey = Math.max(board.height / 2, board.height / 2 - b.y, b.y + b.h - board.height / 2)
      k = Math.max(fitK * 0.45, Math.min(fitK, availW / 2 / ex, availH / 2 / ey))
    }
    held = { k, bx: (size.w - board.width * k) / 2, by: MARGIN_TOP + (availH - board.height * k) / 2 }
    return held
  })
  const tk = $derived(target.k)
  const tbx = $derived(target.bx)
  const tby = $derived(target.by)
  // Camera: Fit (above: auto-framed, eased) or Manual, where you've scrolled, pinched or panned to.
  // A new asset goes back to Fit; in Manual, selecting no longer moves the view.
  let manual = $derived.by((): View | null => {
    void app.focus
    return null
  })
  // Resizing in Manual keeps the same point centred.
  let lastSize = { w: 0, h: 0 }
  $effect(() => {
    const { w, h } = size
    untrack(() => {
      if (manual && lastSize.w) manual = { k: manual.k, bx: manual.bx + (w - lastSize.w) / 2, by: manual.by + (h - lastSize.h) / 2 }
    })
    lastSize = { w, h }
  })
  const view = camera(
    () => ({ k: tk, bx: tbx, by: tby }),
    () => `${size.w}x${size.h}/${asset?.name}/${board.id}`,
    () => manual
  )
  const k = $derived(view.current.k)
  const bx = $derived(view.current.bx)
  const by = $derived(view.current.by)
  const endInteraction = () => {
    interacting = false
    settled++
  }

  // Never draw the full-resolution source interactively (a 24MP photo stalls every frame). Draw a
  // copy sized to what's on screen instead, sharpened only when zooming in past it.
  const dpr = window.devicePixelRatio || 1
  const placed = $derived(asset?.w ? computeLayout(board.width, board.height, asset.w, asset.h, settings) : null)
  const need = $derived(placed ? Math.max(placed.w, placed.h) * k * dpr : 0)
  const thumbEdge = $derived(asset?.thumb ? Math.max(asset.thumb.width, asset.thumb.height) : 0)
  const sourceSize = () => ({ w: asset?.w ?? 0, h: asset?.h ?? 0 })
  const stillProxy = bitmapProxy(() => still, sourceSize, () => need, () => thumbEdge)
  const exactProxy = bitmapProxy(() => exact?.jpeg ?? null, sourceSize, () => need, () => 0)

  // Zoom transitions: the grid thumbnail flies up into the board on enter and back down on exit;
  // stepping between assets crossfades. While the flyer is in the air the canvas stays hidden.
  let entering = $state(false)
  let entered = false
  $effect(() => {
    if (entered || !size.w) return
    entered = true
    untrack(() => {
      if (!asset?.w) return
      const cell = document.querySelector<HTMLCanvasElement>(`.cell[data-name="${CSS.escape(asset.name)}"] canvas[data-ready]`)
      const host = stage.closest<HTMLElement>('.content')
      if (!cell || !host) return
      const s0 = stage.getBoundingClientRect()
      const to = new DOMRect(s0.left + target.bx, s0.top + target.by, board.width * target.k, board.height * target.k)
      entering = true
      fly(host, snapshot(cell), cell.getBoundingClientRect(), to).then((dismiss) => {
        entering = false
        requestAnimationFrame(dismiss)
      })
    })
  })
  // Where the stage is on screen; by the time the view is torn down it's already out of the page.
  let stageRect = new DOMRect()
  $effect(() => {
    void size
    stageRect = stage.getBoundingClientRect()
  })
  $effect(() => {
    // Hold on to the elements too: their references are cleared as the view is torn down.
    const c = canvas
    const host = stage.closest<HTMLElement>('.content')
    return () => {
      // Leaving: capture the board as drawn, then land it on its grid cell once the grid is back.
      const leaving = name
      if (!leaving || !c.width || !host) return
      const w = board.width * k
      const h = board.height * k
      const from = new DOMRect(stageRect.left + bx, stageRect.top + by, w, h)
      const still = snapshot(c, bx * dpr, by * dpr, w * dpr, h * dpr)
      requestAnimationFrame(() =>
        requestAnimationFrame(async () => {
          if (app.view !== 'grid') return
          const cell = document.querySelector<HTMLCanvasElement>(`.cell[data-name="${CSS.escape(leaving)}"] canvas`)
          if (!cell) return
          cell.style.opacity = '0'
          // The grid is still growing back from its receded scale; aim for where the cell settles.
          const dismiss = await fly(host, still, from, settledRect(cell, cell.closest<HTMLElement>('.grid-scroll')!), 300)
          cell.style.opacity = ''
          dismiss()
        })
      )
    }
  })
  // Stepping to another asset crossfades from what was on screen (before it's redrawn).
  let shown = untrack(() => asset?.name)
  $effect.pre(() => {
    const name = asset?.name
    if (shown && name !== shown && canvas) crossfade(canvas)
    shown = name
  })

  // Load the full-res still (image, or poster for video).
  $effect(() => {
    still = null
    if (!path || !sourceW) return
    void mtime
    const a = untrack(() => asset!)
    let alive = true
    loadStill(a)
      .then((src) => alive && (still = src))
      .catch(() => {})
    return () => {
      alive = false
    }
  })

  // Scrub proxy: requested once a video has been open for a moment (not for every one flicked
  // past), built in the background, then loaded into a hidden muted video ready for seeking.
  $effect(() => {
    proxyVideo = null
    scrubSrc = null
    if (!path || !isVideo || !sourceW) return
    void mtime
    const { w, h, color } = untrack(() => asset!)
    let alive = true
    let v: HTMLVideoElement | null = null
    const timer = setTimeout(() => {
      api
        .scrubProxy(path, w, h, color)
        .then((proxyPath) => {
          if (!alive) return
          v = document.createElement('video')
          v.muted = true
          v.preload = 'auto'
          v.crossOrigin = 'anonymous'
          v.src = mediaUrl(proxyPath)
          const pv = v
          pv.addEventListener('loadeddata', () => alive && (proxyVideo = pv), { once: true })
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
  })

  // Video element for playback.
  $effect(() => {
    video = null
    playing = false
    queued = false
    trimDraft = null
    exact = null
    unplayable = false
    if (!path || !isVideo) return
    void mtime
    const clipName = untrack(() => asset!.name)
    const v = document.createElement('video')
    v.crossOrigin = 'anonymous'
    v.playsInline = true
    v.preload = 'auto'
    // Loops natively when untrimmed; the playback loop below handles trimmed ranges.
    v.loop = true
    v.src = mediaUrl(path)
    const fail = () => {
      v.removeAttribute('src')
      v.load()
      unplayable = true
    }
    const ready = () => {
      // Audio but no picture: the video track's codec isn't supported.
      if (!v.videoWidth) return fail()
      v.currentTime = app.project.clips[clipName]?.start ?? 0
      video = v
    }
    v.addEventListener('loadeddata', ready, { once: true })
    v.addEventListener('error', fail, { once: true })
    return () => {
      v.removeEventListener('error', fail)
      v.pause()
      v.removeAttribute('src')
      v.load()
    }
  })

  // Everything a frame is drawn from; the canvas redraws whenever it changes.
  const scene = $derived({
    asset,
    size,
    video,
    stillBitmap: stillProxy.bitmap,
    exact,
    exactBitmap: exactProxy.bitmap,
    k,
    bx,
    by,
    board,
    settings,
    picking: app.picking,
    selected
  })
  $effect(() => draw(scene))

  function draw({ asset, size, video, stillBitmap, exact, exactBitmap, k, bx, by, board, settings, picking, selected } = scene) {
    if (!canvas || !asset || size.w === 0) return
    const pw = Math.round(size.w * dpr)
    const ph = Math.round(size.h * dpr)
    const resized = canvas.width !== pw || canvas.height !== ph
    if (resized) {
      canvas.width = pw
      canvas.height = ph
    }
    const useExact = exact && exactBitmap && video?.paused && Math.abs(exact.t - video.currentTime) < 0.001
    // Mid-seek, a video has no frame to give. Keep what's on screen (it repaints on 'seeked')
    // rather than flash a stand-in like the poster, which made scrubbing flicker.
    const want = scrubSrc ?? (useExact ? null : video)
    if (want && want.seeking && want.readyState < 2 && !resized) return
    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, pw, ph)
    const scrubFrame = scrubSrc && scrubSrc.readyState >= 2 ? scrubSrc : null
    const src: CanvasImageSource | null = scrubFrame ?? (useExact ? exactBitmap : video && video.readyState >= 2 ? video : (stillBitmap ?? asset.thumb))
    const kk = k * dpr
    const ox = bx * dpr
    const oy = by * dpr
    const W = board.width
    const H = board.height
    const p = asset.w ? computeLayout(W, H, asset.w, asset.h, settings) : null
    const active = (selected || dragging) && !picking

    // Overflow outside the board, faintly.
    if (src && p && active) {
      ctx.save()
      ctx.globalAlpha = dragging ? 0.3 : 0.14
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
    if (p && !active && hoverMedia && !picking) {
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
    const g = guides
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
  }
  // Preview audio: silent if the export is muted; otherwise the global preview volume.
  $effect(() => {
    if (!video) return
    video.volume = app.volume
    video.muted = settings.mute || app.volume === 0
  })

  // Esc deselects first (in the capture phase, before the app-wide Esc goes back to the grid).
  function onkeydowncapture(e: KeyboardEvent) {
    if (!selected || e.key !== 'Escape' || app.picking || (e.target as HTMLElement).closest?.('input, textarea')) return
    e.preventDefault()
    e.stopImmediatePropagation()
    selected = false
  }

  // The eyedropper samples the screen; pause so it sees the exact frame, not the browser's decode.
  $effect(() => {
    if (app.picking && video && !video.paused) video.pause()
  })

  // While paused, swap in the exact frame shortly after each seek.
  $effect(() => {
    const v = video
    if (!v || !path || playing) return
    const src = path
    const color = untrack(() => asset?.color)
    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const request = () => {
      clearTimeout(timer)
      const t = v.currentTime
      timer = setTimeout(async () => {
        try {
          const data = await api.frame(src, t, color)
          if (alive && v.paused && Math.abs(v.currentTime - t) < 0.001) exact = { t, jpeg: new Blob([data as BlobPart], { type: 'image/jpeg' }) }
        } catch {
          // Keep showing the browser's frame.
        }
      }, 120)
    }
    request()
    v.addEventListener('seeked', request)
    return () => {
      alive = false
      clearTimeout(timer)
      v.removeEventListener('seeked', request)
    }
  })

  // Repaint frames while playing, looping within the trim range.
  $effect(() => {
    const v = video
    if (!v || !name) return
    void duration
    let raf = 0
    const tick = () => {
      const { start, end } = clip
      if (v.currentTime >= end - 0.01 || v.currentTime < start - 0.05) v.currentTime = start
      time = v.currentTime
      draw()
      if (!v.paused) raf = requestAnimationFrame(tick)
    }
    const onPlay = () => {
      playing = true
      tick()
    }
    const onPause = () => (playing = false)
    const onSeeked = () => {
      // Show each frame as it arrives, then chase the newest target if the pointer has moved on.
      if (pendingSeek != null) {
        draw()
        v.currentTime = pendingSeek
        pendingSeek = null
        return
      }
      // The real frame has landed: stop standing in with the proxy.
      if (!scrubbing) scrubSrc = null
      time = v.currentTime
      draw()
    }
    v.addEventListener('play', onPlay)
    v.addEventListener('pause', onPause)
    v.addEventListener('seeked', onSeeked)
    untrack(() => {
      if (!v.paused) tick()
    })
    return () => {
      cancelAnimationFrame(raf)
      v.removeEventListener('play', onPlay)
      v.removeEventListener('pause', onPause)
      v.removeEventListener('seeked', onSeeked)
    }
  })

  // Play is never disabled: pressed before the video has loaded (slow drives, network or WSL
  // paths, big files), the intent is queued and playback starts as soon as a frame is ready.
  // At most one seek in flight; while it runs only the newest target is kept. Issuing a seek per
  // pointer move makes the browser abandon most of them and the frame stutters.
  let pendingSeek: number | null = null
  function seek(t: number) {
    if (!video) return
    if (video.seeking) pendingSeek = t
    else video.currentTime = t
  }

  // Playhead drags. Playback pauses for the drag (and resumes after). With a proxy, every move
  // seeks the proxy (newest target wins) and its frames are drawn; the real video seeks once, to
  // where the drag ends, and takes over when that frame is ready.
  let proxyPending: number | null = null
  $effect(() => {
    const pv = proxyVideo
    if (!pv) return
    const onSeeked = () => {
      if (scrubSrc === pv) draw()
      if (proxyPending != null) {
        pv.currentTime = proxyPending
        proxyPending = null
      }
    }
    pv.addEventListener('seeked', onSeeked)
    return () => pv.removeEventListener('seeked', onSeeked)
  })
  function scrubStart() {
    scrubbing = { resume: !!video && !video.paused }
    video?.pause()
  }
  function scrubTo(t: number) {
    scrubTime = t
    if (!proxyVideo) return seek(t)
    scrubSrc = proxyVideo
    if (proxyVideo.seeking) proxyPending = t
    else proxyVideo.currentTime = t
  }
  function scrubEnd(t: number) {
    const resume = scrubbing?.resume
    scrubbing = null
    scrubTime = null
    time = t
    seek(t)
    if (resume) video?.play().catch(() => {})
  }

  // A second, muted video just for trim previews, so the main view never has to seek mid-drag.
  let scrubber: { v: HTMLVideoElement; pending: number | null; canvas: HTMLCanvasElement | null } | null = null
  $effect(() => {
    void path
    return () => {
      const s = scrubber
      scrubber = null
      if (s) {
        s.v.removeAttribute('src')
        s.v.load()
      }
    }
  })
  function preview(target: HTMLCanvasElement, t: number) {
    if (!asset) return
    let s = scrubber
    if (!s) {
      const v = document.createElement('video')
      v.muted = true
      v.preload = 'auto'
      v.crossOrigin = 'anonymous'
      v.src = proxyVideo?.src ?? mediaUrl(asset.path)
      const state = { v, pending: null as number | null, canvas: null as HTMLCanvasElement | null }
      const paint = () => {
        const c = state.canvas
        if (!c || !asset?.w || v.readyState < 2) return
        drawFrame(c.getContext('2d')!, v, asset.w, asset.h, board.width, board.height, settings, c.width / board.width)
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
      s = scrubber = state
    }
    s.canvas = target
    if (s.v.readyState < 2 || s.v.seeking) s.pending = t
    else s.v.currentTime = t
  }

  function toggle() {
    if (unplayable) return app.showHud('Can’t play this format here yet · scrubbing, trimming and export still work')
    if (!video) return void (queued = !queued)
    if (video.paused) video.play().catch(() => {})
    else video.pause()
  }

  $effect(() => {
    if (!queued) return
    if (unplayable) {
      queued = false
      untrack(toggle)
    } else if (video) {
      queued = false
      video.play().catch(() => {})
    }
  })

  /** Client coordinates → artboard pixels. */
  function toBoard(clientX: number, clientY: number): Point {
    const r = stage.getBoundingClientRect()
    return { x: (clientX - r.left - bx) / k, y: (clientY - r.top - by) / k }
  }

  function hitTest(pt: Point): { mode: Mode; cursor: string } {
    const a = asset
    if (!a?.w) return { mode: { kind: 'none' }, cursor: 'default' }
    const p = computeLayout(board.width, board.height, a.w, a.h, settings)
    const cs = corners(p)
    const dist = cs.map((c) => Math.hypot(c.x - pt.x, c.y - pt.y) * k)
    const i = dist.indexOf(Math.min(...dist))
    // The resize cursor points from the centre through the grabbed handle.
    const grab = (handle: Point) => {
      const at = fromLocal(p, handle)
      const ang = (Math.atan2(at.y - p.cy, at.x - p.cx) * 180) / Math.PI
      return { mode: { kind: 'scale', handle } as Mode, cursor: resizeCursor(ang) }
    }
    if (selected && dist[i] <= HIT_HANDLE) return grab({ x: i === 1 || i === 2 ? 1 : 0, y: i >= 2 ? 1 : 0 })
    const l = toLocal(p, pt)
    // Anywhere along an edge grabs it, like an invisible handle at its midpoint.
    if (selected) {
      const gap = [Math.abs(l.y) * p.h, Math.abs(l.x - 1) * p.w, Math.abs(l.y - 1) * p.h, Math.abs(l.x) * p.w]
      const along = [l.x, l.y, l.x, l.y]
      let edge = -1
      let best = HIT_EDGE
      gap.forEach((g, j) => {
        if (g * k <= best && along[j] >= 0 && along[j] <= 1) {
          edge = j
          best = g * k
        }
      })
      if (edge >= 0) return grab(EDGE_MID[edge])
    }
    const onMedia = l.x >= 0 && l.x <= 1 && l.y >= 0 && l.y <= 1
    // Unselected, only the visible (in-board) part is clickable, like clipped content in Figma.
    // Selected, the ghosted overflow is part of it too.
    const inside = onMedia && (selected || (pt.x >= 0 && pt.x <= board.width && pt.y >= 0 && pt.y <= board.height))
    if (selected && !onMedia && dist[i] <= HIT_ROTATE) return { mode: { kind: 'rotate' }, cursor: ROTATE_CURSOR }
    if (inside) return { mode: { kind: 'move' }, cursor: selected ? 'move' : 'default' }
    return { mode: { kind: 'none' }, cursor: 'default' }
  }

  // Camera moves, in stage pixels.
  const current = (): View => manual ?? { k, bx, by }
  function zoomView(factor: number, sx: number, sy: number) {
    const v = current()
    const k1 = Math.min(40, Math.max(0.02, v.k * factor))
    const px = (sx - v.bx) / v.k
    const py = (sy - v.by) / v.k
    manual = { k: k1, bx: sx - px * k1, by: sy - py * k1 }
  }
  function panView(dx: number, dy: number) {
    const v = current()
    manual = { k: v.k, bx: v.bx + dx, by: v.by + dy }
  }
  const fitView = () => (manual = null)
  const actualPixels = () => zoomView(1 / dpr / current().k, size.w / 2, size.h / 2)

  // Trackpads: pinch zooms (Chromium reports it as a wheel with ctrlKey), two fingers pan. A mouse
  // wheel zooms. Mouse notches come in whole multiples of 120 with no sideways component; once a
  // gesture looks like a trackpad it stays one, so momentum never flips into zooming.
  // Alt+scroll still scales the image itself.
  let trackpadUntil = 0
  let wheelIdle: ReturnType<typeof setTimeout> | undefined
  $effect(() => () => clearTimeout(wheelIdle))
  function onwheel(e: WheelEvent) {
    e.preventDefault()
    const r = stage.getBoundingClientRect()
    const sx = e.clientX - r.left
    const sy = e.clientY - r.top
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? r.height : 1
    const dx = e.deltaX * unit
    const dy = e.deltaY * unit
    const now = performance.now()
    if (e.altKey) {
      const a = asset
      if (!a?.w) return
      interacting = true
      clearTimeout(wheelIdle)
      wheelIdle = setTimeout(endInteraction, 500)
      const zoom = snapZoom(settings.zoom * Math.exp(-dy * 0.0015), true)
      app.editAsset(a.name, zoomAbout(settings, board.width, board.height, a.w, a.h, zoom, toBoard(e.clientX, e.clientY)))
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

  function onkeydown(e: KeyboardEvent) {
    // Space plays and pauses.
    if (e.code === 'Space') {
      if ((e.target as HTMLElement).closest('input, textarea, button')) return
      e.preventDefault()
      return toggle()
    }
    // ⌘/Ctrl+0 fits; ⌘/Ctrl +/− zoom about the centre.
    if (!(e.metaKey || e.ctrlKey) || (e.target as HTMLElement).closest?.('input, textarea')) return
    if (e.key === '0') fitView()
    else if (e.key === '=' || e.key === '+') zoomView(1.25, size.w / 2, size.h / 2)
    else if (e.key === '-') zoomView(0.8, size.w / 2, size.h / 2)
    else return
    e.preventDefault()
  }

  /** Drags the view; a click that never moves calls `onClick` instead. */
  function startPan(e: PointerEvent, onClick?: () => void) {
    const el = e.currentTarget as HTMLElement
    el.setPointerCapture(e.pointerId)
    let last = { x: e.clientX, y: e.clientY }
    let moved = false
    const move = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 3) return
      if (!moved) cursor = 'grabbing'
      moved = true
      panView(ev.clientX - last.x, ev.clientY - last.y)
      last = { x: ev.clientX, y: ev.clientY }
    }
    const up = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      if (moved) cursor = 'default'
      else onClick?.()
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
  }

  function onpointermove(e: PointerEvent) {
    if (dragging) return
    const hit = hitTest(toBoard(e.clientX, e.clientY))
    const over = hit.mode.kind === 'move'
    if (over !== hoverMedia) {
      hoverMedia = over
      draw()
    }
    if (hit.cursor !== cursor) cursor = hit.cursor
  }

  function onpointerdown(e: PointerEvent) {
    const a = asset
    const b = board
    const start = settings
    const kk = k
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
    if (mode.kind === 'none') return startPan(e, () => (selected = false))
    // Editing defaults (the asset is on screen but not selected): clicking it selects it again.
    if (!app.selected.has(a.name)) app.setSelection([a.name])
    const el = e.currentTarget as HTMLElement
    el.setPointerCapture(e.pointerId)
    selected = true
    const p0 = computeLayout(W, H, a.w, a.h, start)
    const a0 = Math.atan2(pt0.y - p0.cy, pt0.x - p0.cx)
    const x0 = e.clientX
    const y0 = e.clientY
    const stageRect = stage.getBoundingClientRect()
    dragging = true
    interacting = true
    endDrag = () => up()

    // Every move is computed from the drag's start, so modifiers can come and go freely.
    type DragInput = Pick<PointerEvent, 'clientX' | 'clientY' | 'shiftKey' | 'altKey' | 'ctrlKey' | 'metaKey'>
    let last: DragInput = e
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
        guides = r.guides
      } else if (mode.kind === 'scale') {
        // Scales about the opposite corner or edge (Alt: the centre), keeping the aspect ratio;
        // Shift stretches instead, along whichever axes the handle moves. Edges and the centre
        // snap to the board's edges and centre; ⌘/Ctrl turns snapping off.
        const h = mode.handle
        const pivotL = ev.altKey ? { x: 0.5, y: 0.5 } : { x: 1 - h.x, y: 1 - h.y }
        const pivot = fromLocal(p0, pivotL)
        const free = ev.metaKey || ev.ctrlKey
        guides = NO_GUIDES
        if (!ev.shiftKey) {
          const from = fromLocal(p0, h)
          const dx = from.x - pivot.x
          const dy = from.y - pivot.y
          const ratio = Math.max(ZOOM_MIN / start.zoom, ((pt.x - pivot.x) * dx + (pt.y - pivot.y) * dy) / (dx * dx + dy * dy))
          const snapped = free ? null : snapScale(W, H, bounds(p0), pivot, ratio, 6 / kk, { x: true, y: true })
          if (snapped) guides = snapped.guides
          const zoom = Math.min(ZOOM_MAX, snapped ? start.zoom * snapped.ratio : snapZoom(start.zoom * ratio, free))
          // Each branch writes every scale key, so toggling Shift mid-drag swaps cleanly.
          patch = withPivot(start, W, H, a.w, a.h, { zoom, scaleX: start.scaleX, scaleY: start.scaleY }, pivot)
          readout = { ...at, text: `${Math.round(zoom * 100)}%` }
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
              guides = { x: [...guides.x, ...snapped.guides.x], y: [...guides.y, ...snapped.guides.y] }
            }
          }
          const scaleX = start.scaleX * r.x
          const scaleY = start.scaleY * r.y
          patch = withPivot(start, W, H, a.w, a.h, { zoom: start.zoom, scaleX, scaleY }, pivot)
          const parts = [h.x !== 0.5 && `W ${Math.round(scaleX * 100)}%`, h.y !== 0.5 && `H ${Math.round(scaleY * 100)}%`]
          readout = { ...at, text: parts.filter(Boolean).join('  ') }
        }
      } else {
        const ang = Math.atan2(pt.y - p0.cy, pt.x - p0.cx)
        const deg = snapAngle(start.rotation + ((ang - a0) * 180) / Math.PI, ev.shiftKey, ev.altKey || ev.metaKey || ev.ctrlKey)
        patch = rotateAbout(start, W, H, a.w, a.h, deg)
        readout = { ...at, text: `${Math.round(patch.rotation! * 10) / 10}°` }
      }
      app.editAsset(a.name, patch)
    }
    const up = () => {
      endDrag = null
      dragging = false
      endInteraction()
      guides = NO_GUIDES
      readout = null
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      window.removeEventListener('keydown', modifiers, true)
      window.removeEventListener('keyup', modifiers, true)
      draw()
    }
    // Pressing or releasing a modifier re-applies the whole drag at once, without waiting for the
    // pointer to move.
    const modifiers = (ke: KeyboardEvent) => {
      if (!['Shift', 'Alt', 'Control', 'Meta'].includes(ke.key)) return
      ke.preventDefault()
      move({ clientX: last.clientX, clientY: last.clientY, shiftKey: ke.shiftKey, altKey: ke.altKey, ctrlKey: ke.ctrlKey, metaKey: ke.metaKey })
      draw()
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
    window.addEventListener('keydown', modifiers, true)
    window.addEventListener('keyup', modifiers, true)
    draw()
  }

  // Double-click the image to reset its transform; double-click empty space to go back to the grid.
  function ondblclick(e: MouseEvent) {
    if (hitTest(toBoard(e.clientX, e.clientY)).mode.kind === 'none') app.setView('grid')
    else if (asset) app.resetKeys(['zoom', 'scaleX', 'scaleY', 'offsetX', 'offsetY', 'rotation'], [asset.name])
  }
</script>

<svelte:window {onkeydown} {onkeydowncapture} />

<div class="single">
  <div
    class="stage"
    role="presentation"
    bind:this={stage}
    bind:clientWidth={stageW}
    bind:clientHeight={stageH}
    style:cursor
    {onwheel}
    {onpointerdown}
    {onpointermove}
    onpointerleave={() => {
      hoverMedia = false
      draw()
    }}
    {ondblclick}
    oncontextmenu={(e) => {
      e.preventDefault()
      if (asset) assetMenu(asset.name, asset.path, { x: e.clientX, y: e.clientY }, true)
    }}
  >
    <canvas bind:this={canvas} style:width={`${size.w}px`} style:height={`${size.h}px`} style:opacity={entering ? 0 : 1}></canvas>
    {#if asset}
      <button
        class="zoom-chip"
        title={manual ? `Fit to view (${combo(MOD, '0')})` : 'Actual pixels'}
        onpointerdown={(e) => e.stopPropagation()}
        onclick={() => (manual ? fitView() : actualPixels())}
      >
        {manual ? `${Math.round(k * dpr * 100)}%` : 'Fit'}
      </button>
    {/if}
    {#if readout}<div class="readout" style:left={`${readout.x}px`} style:top={`${readout.y}px`}>{readout.text}</div>{/if}
    {#if !app.focus}<div class="empty-hint">Nothing selected</div>{/if}
  </div>
  <div class="single-fade"></div>
  <!-- Floating over the reserved band at the bottom of the stage: the player, then the filmstrip. -->
  <div class="single-overlay">
    {#if asset && isVideo && asset.duration > 0}
      {@const a = asset}
      <div class="player">
        <!-- Both glyphs stay mounted and crossfade, so the button never pops. -->
        <button
          class={['play', { playing: playing || queued, loading: queued, unavailable: unplayable }]}
          onclick={toggle}
          title={unplayable ? 'This format can’t play here yet' : 'Play / Pause (Space)'}
        >
          <span class="glyph play-glyph"><Icon name="play" size={14} /></span>
          <span class="glyph pause-glyph"><Icon name="pause" size={14} /></span>
        </button>
        <span class="time">{fmtTime(Math.max(0, (scrubTime ?? time) - clip.start))}</span>
        <Timeline
          duration={a.duration}
          start={clip.start}
          end={clip.end}
          time={scrubTime ?? time}
          aspect={board.width / board.height}
          onScrubStart={scrubStart}
          onSeek={scrubTo}
          onScrubEnd={scrubEnd}
          onPreview={preview}
          onTrim={(start, end) => (trimDraft = { start, end })}
          onTrimEnd={(start, end) => {
            trimDraft = null
            app.setClip(a.name, { start, end: end >= a.duration - 0.01 ? null : end })
            // Keep the view's frame unless it's now outside the trimmed range.
            if (video && (video.currentTime < start || video.currentTime > end)) seek(start)
          }}
        />
        <span class="time muted">{fmtTime(clip.end - clip.start)}</span>
        {#if a.audio === false || settings.mute}
          <span class="icon-btn static" title={a.audio === false ? 'No audio track' : 'Audio is muted for export'}><Icon name="volumeOff" /></span>
        {:else}
          <Volume />
        {/if}
      </div>
    {/if}
    <div class="film-row">
      <span class="film-count">{index + 1}<span class="muted">{` / ${count}`}</span></span>
      <button class="icon-btn" title="Previous (←)" disabled={index <= 0} onclick={() => app.step(-1)}><Icon name="prev" /></button>
      <Filmstrip />
      <button class="icon-btn" title="Next (→)" disabled={index >= count - 1} onclick={() => app.step(1)}><Icon name="next" /></button>
    </div>
  </div>
</div>
