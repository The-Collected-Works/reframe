<script lang="ts">
  import { drawFrame, resolveSettings } from '@shared/layout'
  import type { Artboard, AssetEntry } from '@shared/types'
  import { visibility } from '../../lib/attach'
  import { scheduleDraw } from '../../lib/draw-queue'
  import { fmtTime } from '../../lib/format'
  import { app, withMeta } from '../../state/app.svelte'
  import { baseName, folderOf } from '../../state/library'
  import { prioritize } from '../../state/loading'
  import { hasOverrides } from '../../state/project'
  import { assetMenu } from '../menus'
  import { dragOffset, NO_GUIDES, type Guides } from '../snapping'
  import { HoverPreview } from './preview.svelte'

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
  const preview = new HoverPreview(
    () => asset,
    () => clip,
    () => active && !app.picking,
    () => draw()
  )
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
    const fade = preview.fade.current
    const video = fade > 0 ? preview.video : null
    if (video && fade >= 1) {
      drawFrame(ctx, video, asset.w, asset.h, board.width, board.height, settings, kk)
    } else {
      drawFrame(ctx, asset.thumb, asset.w, asset.h, board.width, board.height, settings, kk)
      if (video) {
        // Compose the video frame on its own, then lay it over the thumbnail. Fading drawFrame
        // directly would also fade in its background fill and darken the blend mid-way.
        if (!layer || layer.width !== pw || layer.height !== ph) layer = new OffscreenCanvas(pw, ph)
        drawFrame(layer.getContext('2d')!, video, asset.w, asset.h, board.width, board.height, settings, kk)
        ctx.globalAlpha = fade
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
    onpointerenter={asset.kind === 'video' ? () => (preview.hovering = true) : undefined}
    onpointerleave={asset.kind === 'video' ? () => (preview.hovering = false) : undefined}
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
