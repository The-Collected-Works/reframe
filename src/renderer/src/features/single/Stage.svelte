<!--
  The single view's canvas: the artboard with its media, framed by the camera, and the transform
  gizmo (Figma-style: handles, the overflow ghost and the framing that keeps the handles on screen
  appear only while the media is selected; click it to select, click empty space or Esc to deselect).
-->
<script lang="ts">
  import { untrack } from 'svelte'
  import { bounds, computePlacement, type Point } from '@shared/framing/framing'
  import type { Artboard, CropSettings, SettingKey } from '@shared/types'
  import { trackPointer } from '../../lib/drag'
  import { hint, useKeymap } from '../../lib/keymap.svelte'
  import { loadStill } from '../../lib/media'
  import type { Asset } from '../../state/library.svelte'
  import { SINGLE } from '../../config/keymaps'
  import { NO_GUIDES, snapZoom, zoomAbout, type Guides } from '@shared/framing/snapping'
  import { camera, type View } from './camera.svelte'
  import { dragTo, hitTest, type DragStart } from './gizmo'
  import type { Player } from '../../state/playback.svelte'
  import { bitmapProxy } from './proxy.svelte'
  import { WheelNav } from './nav'
  import { drawStage } from './render'
  import { zoomTransitions } from './zoom.svelte'

  let {
    asset,
    board,
    settings,
    playback,
    start = 0,
    picking,
    onNeed,
    onEdit,
    onSelect,
    onReset,
    onExit,
    onMenu
  }: {
    /** What's shown; none when nothing is in focus. */
    asset: Asset | undefined
    board: Artboard
    /** The asset's settings on `board`. */
    settings: CropSettings
    /** A video's playback (its track is the asset's name). */
    playback: Player | null
    /** Where a video starts playing (its trim's start), seconds. */
    start?: number
    /** The eyedropper is open: no editing chrome, it needs the exact picture. */
    picking: boolean
    /** How many device pixels the media covers on screen (so how sharp a copy to play from). */
    onNeed?: (px: number) => void
    onEdit: (patch: Partial<CropSettings>) => void
    /** The media was pressed while it wasn't the selection (the inspector was on the defaults). */
    onSelect: () => void
    onReset: (keys: SettingKey[]) => void
    /** Double-click on empty space: back to the grid. */
    onExit: () => void
    onMenu: (at: { x: number; y: number }) => void
  } = $props()

  // Board placement inside the stage. The player and filmstrip float over the bottom of the stage,
  // in a reserved band that's the same for images and videos, so the board never jumps.
  const MARGIN_X = 48
  const MARGIN_TOP = 40
  /** Matches the CSS: .player height, .film-row heights, and the gaps around them. */
  const RESERVED = 12 + 64 + 12 + 44 + 12 * 2
  const dpr = window.devicePixelRatio || 1

  const placement = $derived(asset?.w ? computePlacement(board.width, board.height, asset.w, asset.h, settings) : null)

  let stage: HTMLDivElement
  let canvas: HTMLCanvasElement
  let width = $state(0)
  let height = $state(0)
  let cursor = $state('default')
  let readout = $state<{ x: number; y: number; text: string } | null>(null)
  // Another asset starts deselected. (By name: the asset object itself is new after every edit.)
  const name = $derived(asset?.name)
  let selected = $derived.by(() => {
    void name
    return false
  })
  let hovering = false
  let dragging = false
  let guides: Guides = NO_GUIDES

  // Framing: the board centred, zoomed out while selected just enough that the media's corners (so
  // the handles) are on screen. Held still while interacting, then eased to the new framing.
  let interacting = false
  let settled = $state(0)
  let held: View = { k: 1, bx: 0, by: 0 }
  const target = $derived.by((): View => {
    void settled
    if (interacting) return held
    const availW = width - MARGIN_X * 2
    const availH = height - MARGIN_TOP - RESERVED
    const fitK = Math.max(0.01, Math.min(availW / board.width, availH / board.height))
    let k = fitK
    if (placement && selected) {
      const b = bounds(placement)
      const ex = Math.max(board.width / 2, board.width / 2 - b.x, b.x + b.w - board.width / 2)
      const ey = Math.max(board.height / 2, board.height / 2 - b.y, b.y + b.h - board.height / 2)
      k = Math.max(fitK * 0.45, Math.min(fitK, availW / 2 / ex, availH / 2 / ey))
    }
    held = { k, bx: (width - board.width * k) / 2, by: MARGIN_TOP + (availH - board.height * k) / 2 }
    return held
  })
  const endInteraction = () => {
    interacting = false
    settled++
  }
  // Camera: Fit (the framing above, eased) or Manual, wherever you've scrolled, pinched or panned
  // to. A new asset goes back to Fit; in Manual, selecting no longer moves the view.
  let manual = $derived.by((): View | null => {
    void name
    return null
  })
  // Resizing in Manual keeps the same point centred.
  let lastSize = { w: 0, h: 0 }
  $effect(() => {
    const w = width
    const h = height
    untrack(() => {
      if (manual && lastSize.w) manual = { k: manual.k, bx: manual.bx + (w - lastSize.w) / 2, by: manual.by + (h - lastSize.h) / 2 }
    })
    lastSize = { w, h }
  })
  const tk = $derived(target.k)
  const tbx = $derived(target.bx)
  const tby = $derived(target.by)
  const cam = camera(
    () => ({ k: tk, bx: tbx, by: tby }),
    () => `${width}x${height}/${asset?.name}/${board.id}`,
    () => manual
  )
  const k = $derived(cam.current.k)

  // Never draw the full-resolution source interactively (a 24MP photo stalls every frame). Draw a
  // copy sized to what's on screen instead, sharpened only when zooming in past it.
  let still = $state.raw<Blob | null>(null)
  // Another file (not the same one's thumbnail arriving) loads its own.
  const path = $derived(asset?.path)
  const mtime = $derived(asset?.mtime)
  const sw = $derived(asset?.w ?? 0)
  // A video's full-size still is its poster: its first frame. One trimmed to start later shows its
  // start frame (its thumbnail) until playback has the frame, rather than a frame it won't play.
  const trimmed = $derived(asset?.kind === 'video' && start > 0)
  $effect(() => {
    still = null
    if (!path || !sw || trimmed) return
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
  const need = $derived(placement ? Math.max(placement.w, placement.h) * k * dpr : 0)
  const sourceSize = () => ({ w: asset?.w ?? 0, h: asset?.h ?? 0 })
  const stillBitmap = bitmapProxy(
    () => still,
    sourceSize,
    () => need,
    () => (asset?.thumb ? Math.max(asset.thumb.width, asset.thumb.height) : 0)
  )
  $effect(() => onNeed?.(need))

  // Everything a frame is drawn from; the canvas redraws whenever it changes.
  const scene = $derived({
    asset,
    width,
    height,
    view: cam.current,
    board,
    settings,
    still: stillBitmap.bitmap,
    // A new frame to show, or the clock moving (paused, the exact frame is for one time only).
    frames: playback?.version,
    time: playback?.time,
    picking,
    selected
  })
  $effect(() => draw(scene))

  function draw(s = scene) {
    if (!canvas || !s.asset || !s.width) return
    const pw = Math.round(s.width * dpr)
    const ph = Math.round(s.height * dpr)
    const resized = canvas.width !== pw || canvas.height !== ph
    if (resized) {
      canvas.width = pw
      canvas.height = ph
    }
    drawStage(canvas.getContext('2d')!, {
      view: s.view,
      dpr,
      board: s.board,
      settings: s.settings,
      sw: s.asset.w,
      sh: s.asset.h,
      source: (s.asset.kind === 'video' ? playback?.frame(s.asset.name) : null) ?? s.still ?? s.asset.thumb,
      active: (s.selected || dragging) && !s.picking,
      dragging,
      hover: hovering && !s.picking,
      guides
    })
  }

  // Zoom transitions: the grid thumbnail flies up into the board on enter and back down on exit;
  // stepping between assets crossfades.
  const zoom = zoomTransitions({
    stage: () => stage,
    canvas: () => canvas,
    name: () => asset?.name,
    drawable: () => !!asset?.w,
    board: () => board,
    width: () => width,
    height: () => height,
    target: () => target,
    view: () => cam.current
  })

  // Ends a gizmo drag still in progress if the view closes mid-drag.
  let endDrag: (() => void) | null = null
  $effect(() => () => endDrag?.())

  /** Client coordinates → artboard pixels. */
  function toBoard(clientX: number, clientY: number): Point {
    const r = stage.getBoundingClientRect()
    const v = cam.current
    return { x: (clientX - r.left - v.bx) / v.k, y: (clientY - r.top - v.by) / v.k }
  }
  const hit = (pt: Point) => (placement ? hitTest(placement, board, pt, k, selected) : { mode: { kind: 'none' as const }, cursor: 'default' })

  // Camera moves, in stage pixels.
  const current = (): View => manual ?? cam.current
  function zoomView(factor: number, sx: number, sy: number) {
    const v = current()
    const k1 = Math.min(40, Math.max(0.02, v.k * factor))
    manual = { k: k1, bx: sx - ((sx - v.bx) / v.k) * k1, by: sy - ((sy - v.by) / v.k) * k1 }
  }
  function panView(dx: number, dy: number) {
    const v = current()
    manual = { k: v.k, bx: v.bx + dx, by: v.by + dy }
  }
  const fitView = () => (manual = null)
  const actualPixels = () => zoomView(1 / dpr / current().k, width / 2, height / 2)

  // Wheel, pinch and two-finger pans move the view (see WheelNav); Alt+scroll scales the media itself.
  const nav = new WheelNav()
  let wheelIdle: ReturnType<typeof setTimeout> | undefined
  $effect(() => () => clearTimeout(wheelIdle))
  function onwheel(e: WheelEvent) {
    e.preventDefault()
    if (e.altKey) {
      if (!asset?.w) return
      interacting = true
      clearTimeout(wheelIdle)
      wheelIdle = setTimeout(endInteraction, 500)
      const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? height : 1)
      const zoom = snapZoom(settings.zoom * Math.exp(-dy * 0.0015), true)
      onEdit(zoomAbout(settings, board.width, board.height, asset.w, asset.h, zoom, toBoard(e.clientX, e.clientY)))
      return
    }
    const g = nav.read(e, stage.getBoundingClientRect())
    if ('zoom' in g) zoomView(g.zoom, g.at.x, g.at.y)
    else panView(g.pan.dx, g.pan.dy)
  }

  // ⌘/Ctrl+0 fits; ⌘/Ctrl +/− zoom about the centre. Esc deselects first (before the app's Esc
  // goes back to the grid).
  useKeymap(SINGLE, {
    fit: () => fitView(),
    zoomIn: () => zoomView(1.25, width / 2, height / 2),
    zoomOut: () => zoomView(0.8, width / 2, height / 2),
    deselect: { when: () => selected, run: () => (selected = false) }
  })

  /** Drags the view; a click that never moves calls `onClick` instead. */
  function startPan(e: PointerEvent, onClick?: () => void) {
    let last = { x: e.clientX, y: e.clientY }
    trackPointer(e, {
      slop: 3,
      start: () => (cursor = 'grabbing'),
      move: (ev) => {
        panView(ev.clientX - last.x, ev.clientY - last.y)
        last = { x: ev.clientX, y: ev.clientY }
      },
      end: (dragged) => (dragged ? (cursor = 'default') : onClick?.())
    })
  }

  function onpointermove(e: PointerEvent) {
    if (dragging) return
    const h = hit(toBoard(e.clientX, e.clientY))
    const over = h.mode.kind === 'move'
    if (over !== hovering) {
      hovering = over
      draw()
    }
    if (h.cursor !== cursor) cursor = h.cursor
  }

  function onpointerdown(e: PointerEvent) {
    // Middle button pans from anywhere.
    if (e.button === 1) {
      e.preventDefault()
      return startPan(e)
    }
    const a = asset
    if (e.button !== 0 || !a?.w) return
    const at = toBoard(e.clientX, e.clientY)
    const { mode } = hit(at)
    // Empty space: drag to pan, click to deselect.
    if (mode.kind === 'none') return startPan(e, () => (selected = false))
    // Editing defaults (the asset is on screen but not selected): clicking it selects it again.
    onSelect()
    selected = true
    const start: DragStart = { mode, start: settings, board, sw: a.w, sh: a.h, k, at }
    const stageRect = stage.getBoundingClientRect()
    dragging = true
    interacting = true

    let last: Pick<PointerEvent, 'clientX' | 'clientY'> = e
    const apply = (clientX: number, clientY: number, mods: { shiftKey: boolean; altKey: boolean; metaKey: boolean; ctrlKey: boolean }) => {
      last = { clientX, clientY }
      const r = dragTo(start, toBoard(clientX, clientY), { shift: mods.shiftKey, alt: mods.altKey, mod: mods.metaKey || mods.ctrlKey })
      guides = r.guides
      readout = r.readout ? { x: clientX - stageRect.left + 16, y: clientY - stageRect.top + 16, text: r.readout } : null
      onEdit(r.patch)
    }
    // Pressing or releasing a modifier re-applies the whole drag at once, without waiting for the
    // pointer to move.
    const modifiers = (ke: KeyboardEvent) => {
      if (!['Shift', 'Alt', 'Control', 'Meta'].includes(ke.key)) return
      ke.preventDefault()
      apply(last.clientX, last.clientY, ke)
      draw()
    }
    endDrag = trackPointer(e, {
      move: (ev) => apply(ev.clientX, ev.clientY, ev),
      end: () => {
        endDrag = null
        dragging = false
        endInteraction()
        guides = NO_GUIDES
        readout = null
        window.removeEventListener('keydown', modifiers, true)
        window.removeEventListener('keyup', modifiers, true)
        draw()
      }
    })
    window.addEventListener('keydown', modifiers, true)
    window.addEventListener('keyup', modifiers, true)
    draw()
  }

  // Double-click the media to reset its transform; double-click empty space to go back to the grid.
  function ondblclick(e: MouseEvent) {
    if (hit(toBoard(e.clientX, e.clientY)).mode.kind === 'none') onExit()
    else if (asset) onReset(['zoom', 'scaleX', 'scaleY', 'offsetX', 'offsetY', 'rotation'])
  }
</script>

<div
  class="stage"
  role="presentation"
  bind:this={stage}
  bind:clientWidth={width}
  bind:clientHeight={height}
  style:cursor
  {onwheel}
  {onpointerdown}
  {onpointermove}
  onpointerleave={() => {
    hovering = false
    draw()
  }}
  {ondblclick}
  oncontextmenu={(e) => {
    e.preventDefault()
    if (asset) onMenu({ x: e.clientX, y: e.clientY })
  }}
>
  <canvas bind:this={canvas} data-eyedropper style:width={`${width}px`} style:height={`${height}px`} style:opacity={zoom.entering ? 0 : 1}></canvas>
  {#if asset}
    <button
      class="zoom-chip"
      title={manual ? `Fit to view (${hint(SINGLE.actions.fit)})` : 'Actual pixels'}
      onpointerdown={(e) => e.stopPropagation()}
      onclick={() => (manual ? fitView() : actualPixels())}
    >
      {manual ? `${Math.round(k * dpr * 100)}%` : 'Fit'}
    </button>
  {/if}
  {#if readout}<div class="readout" style:left={`${readout.x}px`} style:top={`${readout.y}px`}>{readout.text}</div>{/if}
  {#if !asset}<div class="empty-hint">Nothing selected</div>{/if}
</div>

<style>
  .stage {
    position: absolute;
    inset: 0;
    overflow: hidden;
  }

  canvas {
    position: absolute;
    inset: 0;
  }

  /* Floating glass over the media. */
  .zoom-chip {
    position: absolute;
    top: 12px;
    right: 12px;
    height: 28px;
    padding: 0 10px;
    border-radius: 13px;
    background: var(--glass-bg);
    backdrop-filter: var(--glass-filter);
    box-shadow: var(--glass-shadow);
    font-size: 11px;
    font-weight: 500;
    font-variant-numeric: tabular-nums;
    color: var(--muted);
    animation: rise-in 300ms var(--ease) 140ms both;
  }

  .zoom-chip:hover {
    color: var(--text);
  }

  /* The value being dragged (scale, angle), beside the pointer. */
  .readout {
    position: absolute;
    padding: 3px 7px;
    border-radius: 5px;
    background: var(--accent);
    color: #fff;
    font-size: 11px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    pointer-events: none;
    white-space: nowrap;
    animation: pop-in 140ms var(--ease) both;
  }
</style>
