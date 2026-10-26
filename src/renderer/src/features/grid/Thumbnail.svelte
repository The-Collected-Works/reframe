<!--
  One item in the grid: the artboard as it will export, with its name below (and an adjusted dot,
  and a video's length). A variant is marked as one; a grid is drawn from its cells' thumbnails.
  Videos play in place on hover. Drag the picture to move it within the artboard; click to select
  (shift for a range, ⌘/Ctrl to add); double-click to open it.
-->
<script lang="ts">
  import type { Attachment } from 'svelte/attachments'
  import { drawGrid } from '@shared/grid'
  import { drawFrame, resolveSettings } from '@shared/layout'
  import { visibility } from '../../lib/attach'
  import { trackPointer } from '../../lib/drag'
  import { scheduleDraw } from '../../lib/draw-queue'
  import { themeColor } from '../../lib/theme'
  import { fmtTime } from '../../lib/format'
  import type { Entry } from '../../state/model/items'
  import { hasOverrides } from '../../state/model/project'
  import { folderOf } from '../../state/model/tree'
  import { Dot, Icon } from '../../ui'
  import { thumbSource } from '../scene'
  import { dragOffset, NO_GUIDES, type Guides } from '../snapping'
  import { useGrid } from './context'
  import { HoverPreview } from './preview.svelte'

  let { entry, width }: { entry: Entry; width: number } = $props()
  const g = useGrid()
  const scene = $derived(entry.kind === 'grid' ? g.composite(entry.name) : null)
  const home = $derived(entry.source ?? entry.name)

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
  const key = $derived(
    `${JSON.stringify(settings)}|${width}x${height}@${window.devicePixelRatio}|${asset.w}x${asset.h}|${asset.mtime}|${!!asset.thumb}|${scene?.stamp}`
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
    if (asset.thumb || scene) ready = true
    const ctx = canvas.getContext('2d')!
    const kk = k * dpr
    if (scene) {
      drawGrid(ctx, scene.grid, scene.layout, board.width, board.height, kk, thumbSource(scene), EMPTY)
      drawn = key
      return
    }
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
      ctx.strokeStyle = themeColor('--guide')
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

  // Where a grid's cell has nothing in it yet.
  const EMPTY = 'rgba(128, 128, 128, 0.22)'

  // The rename field: focused with its text selected; Enter or leaving it saves, Esc cancels.
  const renameField: Attachment<HTMLInputElement> = (input) => {
    let done = false
    const finish = (save: boolean) => {
      if (done) return
      done = true
      g.rename(entry.name, save ? input.value : null)
    }
    const onkeydown = (e: KeyboardEvent) => {
      e.stopPropagation()
      if (e.key === 'Enter') finish(true)
      else if (e.key === 'Escape') finish(false)
    }
    const onblur = () => finish(true)
    input.addEventListener('keydown', onkeydown)
    input.addEventListener('blur', onblur)
    input.focus()
    input.select()
    return () => {
      input.removeEventListener('keydown', onkeydown)
      input.removeEventListener('blur', onblur)
    }
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

    const start = resolveSettings(board, asset.name)
    const { w, h, name } = asset
    const kk = k
    trackPointer(e, {
      slop: 4,
      // A playing hover preview holds still while it's dragged.
      start: () => preview.hold(true),
      move: (ev) => {
        const r = dragOffset(start, board.width, board.height, w, h, (ev.clientX - e.clientX) / kk, (ev.clientY - e.clientY) / kk, 5 / kk, {
          shift: ev.shiftKey,
          alt: ev.altKey
        })
        guides = r.guides
        g.move(name, r.patch)
      },
      end: (dragged) => {
        guides = NO_GUIDES
        draw()
        if (dragged) preview.hold(false)
        else g.click(name)
      }
    })
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
    <canvas bind:this={canvas} data-eyedropper data-ready={ready || undefined} style:width={`${width}px`} style:height={`${height}px`}></canvas>
    {#if !scene && !asset.thumb && !asset.error}<div class="cell-loading"></div>{/if}
    {#if asset.error}<div class="cell-error">Can’t read file</div>{/if}
    <!-- Without the caption row, the adjusted dot sits on the picture's corner instead. -->
    {#if !g.names && overridden}<span class="corner-dot"><Dot title="Adjusted" /></span>{/if}
  </div>
  {#if g.names}
    <div class="cell-meta">
      {#if overridden}<Dot title="Adjusted" />{/if}
      {#if entry.kind === 'grid'}
        <span class="cell-kind" title="Grid"><Icon name="layout" size={12} /></span>
      {:else if entry.source}
        <span class="cell-kind" title={`Variant of ${entry.source}`}><Icon name="variant" size={12} /></span>
      {/if}
      {#if g.renaming(entry.name)}
        <input class="cell-rename" value={entry.label} aria-label="Name" spellcheck="false" onpointerdown={(e) => e.stopPropagation()} {@attach renameField} />
      {:else}
        <span class="cell-name" title={entry.source ? `${entry.label} · from ${entry.source}` : entry.kind === 'grid' ? entry.label : asset.name}>
          {#if g.withFolder && entry.kind !== 'grid' && folderOf(home)}<span class="cell-folder">{folderOf(home)}/</span>{/if}{entry.label}
        </span>
      {/if}
      {#if asset.kind === 'video' && asset.duration > 0}
        <span class="cell-dur">{fmtTime((clip?.end ?? asset.duration) - (clip?.start ?? 0))}</span>
      {:else if scene?.duration}
        <span class="cell-dur">{fmtTime(scene.duration)}</span>
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

  .corner-dot {
    position: absolute;
    top: 6px;
    right: 6px;
    z-index: 2;
    display: grid;
    padding: 3px;
    border-radius: 50%;
    background: rgba(0, 0, 0, 0.55);
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

  /* What kind of item it is, when not a file: a variant or a grid. */
  .cell-kind {
    display: grid;
    place-items: center;
    flex: none;
    color: var(--faint);
  }

  .selected .cell-kind {
    color: var(--muted);
  }

  .cell-rename {
    flex: 1;
    min-width: 0;
    height: 20px;
    margin: 0 -4px;
    padding: 0 4px;
    border: 0;
    border-radius: 4px;
    outline: 0;
    background: var(--tint-2);
    box-shadow: 0 0 0 1px var(--accent);
    color: var(--text);
    font-size: 11px;
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
