<!--
  One asset in the grid: the artboard as it will export, with its name below (and an adjusted dot,
  and a video's length). Videos play in place on hover. Drag the picture to move it within the
  artboard; click to select (shift for a range, ⌘/Ctrl to add); double-click to open it.
-->
<script lang="ts">
  import { drawFrame, resolveSettings } from '@shared/layout'
  import type { AssetEntry } from '@shared/types'
  import { visibility } from '../../lib/attach'
  import { scheduleDraw } from '../../lib/draw-queue'
  import { fmtTime } from '../../lib/format'
  import { hasOverrides } from '../../state/model/project'
  import { baseName, folderOf } from '../../state/model/tree'
  import { Dot } from '../../ui'
  import { dragOffset, NO_GUIDES, type Guides } from '../snapping'
  import { useGrid } from './context'
  import { HoverPreview } from './preview.svelte'

  let { entry, width }: { entry: AssetEntry; width: number } = $props()
  const g = useGrid()

  // Only this thumbnail's own loaded details: another one arriving doesn't touch it.
  const asset = $derived(g.asset(entry))
  const board = $derived(g.board)
  const selected = $derived(g.selected(entry.name))
  const focused = $derived(g.focused(entry.name))
  const clip = $derived(g.clip(entry.name))
  const settings = $derived(resolveSettings(board, entry.name))
  const height = $derived(Math.round((width * board.height) / board.width))
  const overridden = $derived(hasOverrides(board, entry.name))
  const k = $derived(width / board.width)

  let canvas: HTMLCanvasElement
  // Drawn at least once with the thumbnail: it fades in (and view transitions know it has pixels).
  let ready = $state(false)
  const preview = new HoverPreview(
    () => asset,
    () => clip,
    () => g.previews,
    () => draw()
  )
  let layer: OffscreenCanvas | null = null
  let guides: Guides = NO_GUIDES
  let visible = $state(false)
  // What's on the canvas, so unchanged cells skip redrawing.
  let drawn = ''
  const key = $derived(`${JSON.stringify(settings)}|${width}x${height}@${window.devicePixelRatio}|${asset.w}x${asset.h}|${asset.mtime}|${!!asset.thumb}`)

  function draw() {
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    const pw = Math.round(width * dpr)
    const ph = Math.round(height * dpr)
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw
      canvas.height = ph
    }
    if (asset.thumb) ready = true
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
    if (g.active && visible && drawn !== key) scheduleDraw(task)
  })
  const onVisible = (v: boolean) => {
    visible = v
    if (v && !asset.thumb) g.seen(asset)
  }

  function onpointerdown(e: PointerEvent) {
    if (e.button !== 0) return
    const mode = e.shiftKey ? 'range' : e.metaKey || e.ctrlKey ? 'toggle' : 'replace'
    g.press(asset.name, mode)
    if (mode !== 'replace' || !asset.w) return

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
      g.move(name, r.patch)
    }
    const up = () => {
      guides = NO_GUIDES
      draw()
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      if (!dragging) g.click(name)
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
    g.menu(asset, { x: e.clientX, y: e.clientY })
  }}
  class={['cell', { selected, focused, skipped: settings.skip }]}
>
  <div
    {@attach visibility(onVisible)}
    class="frame"
    role="presentation"
    style:height={`${height}px`}
    {onpointerdown}
    ondblclick={g.open}
    onpointerenter={asset.kind === 'video' ? () => (preview.hovering = true) : undefined}
    onpointerleave={asset.kind === 'video' ? () => (preview.hovering = false) : undefined}
  >
    <canvas bind:this={canvas} data-ready={ready || undefined} style:width={`${width}px`} style:height={`${height}px`}></canvas>
    {#if !asset.thumb && !asset.error}<div class="cell-loading"></div>{/if}
    {#if asset.error}<div class="cell-error">Can’t read file</div>{/if}
  </div>
  {#if g.names}
    <div class="cell-meta">
      {#if overridden}<Dot title="Adjusted" />{/if}
      <span class="cell-name" title={asset.name}>
        {#if g.withFolder && folderOf(asset.name)}<span class="cell-folder">{folderOf(asset.name)}/</span>{/if}{baseName(asset.name)}
      </span>
      {#if asset.kind === 'video' && asset.duration > 0}
        <span class="cell-dur">{fmtTime((clip?.end ?? asset.duration) - (clip?.start ?? 0))}</span>
      {/if}
    </div>
  {/if}
</div>

<style>
  /* Each cell sits on a mat; selection fills the mat so the frame's own edge stays readable. */
  .cell {
    min-width: 0;
    padding: 10px 10px 2px;
    border-radius: 9px;
    transition:
      background-color var(--t-med) var(--ease),
      box-shadow var(--t-med) var(--ease);
  }

  /* Without the caption row (file names hidden), the mat is even on all four sides. */
  .cell:not(:has(.cell-meta)) {
    padding-bottom: 10px;
  }

  .cell:hover {
    background: rgba(255, 255, 255, 0.025);
  }

  .cell.selected {
    background: var(--raised);
  }

  .cell.selected.focused {
    background: #2a2a31;
  }

  .frame {
    position: relative;
    overflow: hidden;
    background: var(--panel);
  }

  /* Hairline on top of the content, so the artboard edge shows even against black. */
  .frame::before {
    content: '';
    position: absolute;
    inset: 0;
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.14);
    pointer-events: none;
    z-index: 1;
  }

  canvas {
    display: block;
    opacity: 0;
    transition: opacity 260ms var(--ease);
  }

  canvas[data-ready] {
    opacity: 1;
  }

  .skipped canvas {
    opacity: 0.25;
  }

  /* Excluded from export: dimmed, with a faint X from corner to corner (1px at any size or shape).
     Inside the frame's hairline, so the two never overlap and brighten the corners. */
  .skipped .frame::after {
    content: '';
    position: absolute;
    inset: 1px;
    background: var(--excluded-x) no-repeat center / 100% 100%;
    pointer-events: none;
  }

  .cell-loading {
    position: absolute;
    inset: 0;
    background: linear-gradient(100deg, transparent 30%, rgba(255, 255, 255, 0.03) 50%, transparent 70%) var(--panel);
    background-size: 200% 100%;
    animation: shimmer 1.4s linear infinite;
    transition: opacity 260ms var(--ease);
  }

  @keyframes shimmer {
    from {
      background-position: 150% 0;
    }
    to {
      background-position: -50% 0;
    }
  }

  .cell-error {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    color: var(--faint);
    font-size: 11px;
  }

  .cell-meta {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 28px;
    padding-top: 6px;
    color: var(--muted);
    font-size: 11px;
  }

  .selected .cell-meta {
    color: var(--text);
  }

  .cell-name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* The folder before a name, when the grid isn't grouped by folder. */
  .cell-folder {
    color: var(--faint);
  }

  .cell-dur {
    color: var(--faint);
    font-variant-numeric: tabular-nums;
  }
</style>
