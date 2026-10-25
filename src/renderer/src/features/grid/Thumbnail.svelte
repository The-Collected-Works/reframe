<script lang="ts">
  import { untrack } from 'svelte'
  import { cubicOut } from 'svelte/easing'
  import { Tween } from 'svelte/motion'
  import { drawFrame, resolveSettings } from '@shared/layout'
  import { posterTime } from '@shared/media'
  import type { Artboard, AssetEntry } from '@shared/types'
  import { fmtTime } from '../../lib/format'
  import { dragOffset, NO_GUIDES, type Guides } from '../single/snapping'
  import { visibility } from '../../lib/attach'
  import { scheduleDraw } from '../../lib/draw-queue'
  import { mediaUrl, prioritize } from '../../state/loading'
  import { assetMenu } from '../menus'
  import { app, baseName, folderOf, hasOverrides, withMeta } from '../../state/app.svelte'
  import { scroll } from './shared'

  const SCROLL_SETTLE = 250
  const PREVIEW_DWELL = 150

  let {
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
  } = $props()

  // Only this cell's own loaded details: another thumbnail arriving doesn't touch it.
  const asset = $derived(withMeta(entry, app.meta.get(entry.name)))
  const selected = $derived(app.selected.has(entry.name))
  const focused = $derived(app.focus === entry.name)
  const clip = $derived(app.project.clips[entry.name])
  const settings = $derived(resolveSettings(board, entry.name))
  const height = $derived(Math.round((width * board.height) / board.width))
  const overridden = $derived(hasOverrides(board, entry.name))
  const k = $derived(width / board.width)

  let canvas: HTMLCanvasElement
  // Hover preview: `live` is the playing video, crossfaded over the thumbnail by `fade` (0..1).
  let live: HTMLVideoElement | null = null
  const fade = new Tween(0, { duration: 180, easing: cubicOut })
  $effect(() => {
    void fade.current
    if (live) untrack(draw)
  })
  let layer: OffscreenCanvas | null = null
  let guides: Guides = NO_GUIDES
  let visible = $state(false)
  // What's on the canvas, so unchanged cells skip redrawing.
  let drawn = ''
  const key = $derived(
    `${JSON.stringify(settings)}|${width}x${height}@${window.devicePixelRatio}|${asset.w}x${asset.h}|${asset.mtime}|${!!asset.thumb}`
  )

  function draw() {
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    const pw = Math.round(width * dpr)
    const ph = Math.round(height * dpr)
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw
      canvas.height = ph
    }
    // First draw fades the thumbnail in (CSS), and tells view transitions it has pixels.
    if (!canvas.dataset.ready && asset.thumb) canvas.dataset.ready = '1'
    const ctx = canvas.getContext('2d')!
    const kk = k * dpr
    const video = fade.current > 0 ? live : null
    if (video && fade.current >= 1) {
      drawFrame(ctx, video, asset.w, asset.h, board.width, board.height, settings, kk)
    } else {
      drawFrame(ctx, asset.thumb, asset.w, asset.h, board.width, board.height, settings, kk)
      if (video) {
        // Compose the video frame on its own, then lay it over the thumbnail. Fading drawFrame
        // directly would also fade in its background fill and darken the blend mid-way.
        if (!layer || layer.width !== pw || layer.height !== ph) layer = new OffscreenCanvas(pw, ph)
        drawFrame(layer.getContext('2d')!, video, asset.w, asset.h, board.width, board.height, settings, kk)
        ctx.globalAlpha = fade.current
        ctx.drawImage(layer, 0, 0)
        ctx.globalAlpha = 1
      }
    }
    const g = guides
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
    drawn = video || g.x.length || g.y.length ? '' : key
  }

  // Drawn (in the shared per-frame budget) whenever what it shows changes while it's on screen.
  const task = () => draw()
  $effect(() => {
    if (active && visible && drawn !== key) scheduleDraw(task)
  })
  const onVisible = (v: boolean) => {
    visible = v
    if (v && !asset.thumb) prioritize(asset.path)
  }

  // A hover becomes a preview only once the pointer has rested on the thumbnail and the grid has
  // stopped scrolling: thumbnails sliding under a still pointer mid-scroll shouldn't each start
  // loading and decoding a video.
  let hover = $state(false)
  let previewing = $state(false)
  $effect(() => {
    if (!hover) return void (previewing = false)
    const since = performance.now()
    let t: ReturnType<typeof setTimeout> | undefined
    const check = () => {
      const now = performance.now()
      const wait = Math.max(since + PREVIEW_DWELL - now, scroll.last + SCROLL_SETTLE - now)
      if (wait > 0) t = setTimeout(check, wait)
      else previewing = true
    }
    check()
    return () => clearTimeout(t)
  })

  function release(v: HTMLVideoElement) {
    v.pause()
    v.removeAttribute('src')
    v.load()
  }

  // Hover to preview video in place. Starts on the thumbnail's own frame and only fades in once
  // the video has actually presented a frame, so there's no jump or blank flash either way.
  $effect(() => {
    // Not while the eyedropper is open: the exact thumbnail is what should be on screen.
    if (!previewing || app.picking || !active || asset.kind !== 'video' || !asset.w) return
    const v = document.createElement('video')
    v.crossOrigin = 'anonymous'
    v.muted = true
    v.playsInline = true
    v.preload = 'auto'
    v.src = mediaUrl(asset.path)
    const start = clip?.start ?? 0
    const end = clip?.end ?? asset.duration
    v.currentTime = Math.min(Math.max(posterTime(asset.duration), start), Math.max(start, end - 0.1))
    let alive = true

    // Redraw on every presented video frame, looping within the trim.
    const onFrame = () => {
      if (!alive) return
      if (v.currentTime >= end - 0.03) v.currentTime = start
      if (live === v) draw()
      v.requestVideoFrameCallback(onFrame)
    }
    const first = () => {
      if (!alive) return
      // A previous hover may still be fading out; this one takes over from its current opacity.
      if (live && live !== v) release(live)
      live = v
      fade.target = 1
      onFrame()
    }
    v.play()
      .then(() => v.requestVideoFrameCallback(first))
      .catch(() => {})

    return () => {
      alive = false
      if (live !== v) return release(v)
      // Hold the last frame and fade back to the thumbnail.
      v.pause()
      fade.set(0).then(() => {
        if (live === v) live = null
        release(v)
      })
    }
  })

  function onpointerdown(e: PointerEvent) {
    if (e.button !== 0) return
    const mode = e.shiftKey ? 'range' : e.metaKey || e.ctrlKey ? 'toggle' : 'replace'
    if (mode !== 'replace') return app.select(asset.name, mode)
    if (selected) app.focus = asset.name
    else app.select(asset.name)
    if (!asset.w) return

    const el = e.currentTarget as HTMLElement
    el.setPointerCapture(e.pointerId)
    const start = resolveSettings(board, asset.name)
    const { w, h, name } = asset
    const kk = k
    const x0 = e.clientX
    const y0 = e.clientY
    let dragging = false
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - x0) / kk
      const dy = (ev.clientY - y0) / kk
      if (!dragging && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4) return
      dragging = true
      const r = dragOffset(start, board.width, board.height, w, h, dx, dy, 5 / kk, { shift: ev.shiftKey, alt: ev.altKey })
      guides = r.guides
      app.editAsset(name, r.patch)
    }
    const up = () => {
      guides = NO_GUIDES
      draw()
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      if (!dragging) app.select(name)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
  }
</script>

<div
  data-name={entry.name}
  role="presentation"
  oncontextmenu={(e) => {
    e.preventDefault()
    assetMenu(asset.name, asset.path, { x: e.clientX, y: e.clientY })
  }}
  class={['cell', { selected, focused, skipped: settings.skip }]}
>
  <div
    {@attach visibility(onVisible)}
    class="frame"
    role="presentation"
    style:height={`${height}px`}
    {onpointerdown}
    ondblclick={() => app.setView('single')}
    onpointerenter={asset.kind === 'video' ? () => (hover = true) : undefined}
    onpointerleave={asset.kind === 'video' ? () => (hover = false) : undefined}
  >
    <canvas bind:this={canvas} style:width={`${width}px`} style:height={`${height}px`}></canvas>
    {#if !asset.thumb && !asset.error}<div class="cell-loading"></div>{/if}
    {#if asset.error}<div class="cell-error">Can’t read file</div>{/if}
  </div>
  {#if names}
    <div class="cell-meta">
      {#if overridden}<span class="dot" title="Adjusted"></span>{/if}
      <span class="cell-name" title={asset.name}>
        {#if withFolder && folderOf(asset.name)}<span class="cell-folder">{folderOf(asset.name)}/</span>{/if}{baseName(asset.name)}
      </span>
      {#if asset.kind === 'video' && asset.duration > 0}
        <span class="cell-dur">{fmtTime((clip?.end ?? asset.duration) - (clip?.start ?? 0))}</span>
      {/if}
    </div>
  {/if}
</div>
