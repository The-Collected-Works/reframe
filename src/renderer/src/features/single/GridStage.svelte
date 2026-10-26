<!--
  The grid editor's canvas: the grid on its artboard, framed by the camera. Drag a gap between
  cells to share the space differently (on this artboard); click a cell to frame what it shows,
  with the same gizmo as a single asset, clipped to its cell; drag the selected cell's tab onto
  another to swap them. Takes props; the single view connects it.
-->
<script lang="ts">
  import { findNode, isSplit, type CellSource, type GridDivider } from '@shared/grid'
  import { bounds, computeLayout, type Placement, type Point } from '@shared/layout'
  import type { Artboard, CropSettings, GridSlot, SettingKey } from '@shared/types'
  import { trackPointer } from '../../lib/drag'
  import { hint, useKeymap } from '../../lib/keymap.svelte'
  import { Icon } from '../../ui'
  import { GRID_EDITOR, SINGLE } from '../keymaps'
  import type { GridScene } from '../scene'
  import { NO_GUIDES, snapZoom, zoomAbout, type Guides } from '../snapping'
  import { camera, type View } from './camera.svelte'
  import { dragGap, gapAt } from './gaps'
  import { dragTo, hitTest, type DragStart, type Mode } from './gizmo'
  import type { GridPlayer } from './gridPlayer.svelte'
  import { WheelNav } from './nav'
  import { drawGridStage } from './render'
  import { zoomTransitions } from './zoom.svelte'

  let {
    board,
    scene,
    slot,
    player,
    picking,
    onSelect,
    onEdit,
    onReset,
    onArrange,
    onSwap,
    onChoose,
    onRemove,
    onMenu,
    onExit
  }: {
    board: Artboard
    scene: GridScene
    /** The cell being edited. */
    slot: string | null
    player: GridPlayer | null
    /** The eyedropper is open: no editing chrome, it needs the exact picture. */
    picking: boolean
    onSelect: (slot: string | null) => void
    onEdit: (slot: string, patch: Partial<CropSettings>) => void
    onReset: (slot: string, keys: SettingKey[]) => void
    /** New shares for one split's children, on this artboard. */
    onArrange: (split: string, weights: number[]) => void
    onSwap: (a: string, b: string) => void
    /** Choose what an empty cell shows. */
    onChoose: (slot: string) => void
    onRemove: () => void
    onMenu: (slot: string, at: { x: number; y: number }) => void
    /** Double-click on empty space: back to the grid. */
    onExit: () => void
  } = $props()

  // As the asset stage: the board placed clear of the bottom band (player and filmstrip).
  const MARGIN_X = 48
  const MARGIN_TOP = 40
  const RESERVED = 12 + 64 + 12 + 44 + 12 * 2
  const dpr = window.devicePixelRatio || 1
  const TRANSFORM: SettingKey[] = ['zoom', 'scaleX', 'scaleY', 'offsetX', 'offsetY', 'rotation']

  const layout = $derived(scene.layout)
  const cellOf = (id: string | null) => (id ? layout.cells.find((c) => c.slot.id === id) : undefined)
  /** A cell's own artboard: the gizmo frames media in it exactly as in a whole artboard. */
  const cellBoard = (r: { w: number; h: number }): Artboard => ({ ...board, width: r.w, height: r.h })

  const selected = $derived.by(() => {
    const cell = cellOf(slot)
    if (!cell) return null
    const c = scene.cells.get(cell.slot.id)
    const a = c?.asset
    const local = a?.w ? computeLayout(cell.rect.w, cell.rect.h, a.w, a.h, c!.settings) : null
    return { cell, asset: a, settings: c!.settings, local, placement: local ? onBoard(local, cell.rect) : null }
  })
  const onBoard = (p: Placement, r: { x: number; y: number }): Placement => ({ ...p, cx: p.cx + r.x, cy: p.cy + r.y })

  let stage: HTMLDivElement
  let canvas: HTMLCanvasElement
  let width = $state(0)
  let height = $state(0)
  let cursor = $state('default')
  let readout = $state<{ x: number; y: number; text: string } | null>(null)
  let hoverCell = $state<string | null>(null)
  let hoverGap = $state<GridDivider | null>(null)
  let dropCell = $state<string | null>(null)
  let dragging = $state(false)
  let guides: Guides = NO_GUIDES

  // Framing: the board centred, zoomed out while a cell is selected just enough that its media's
  // corners (the handles) are on screen. Held still while interacting, then eased to the new one.
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
    if (selected?.placement) {
      const b = bounds(selected.placement)
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
  let manual = $derived.by((): View | null => {
    void scene.key
    return null
  })
  const tk = $derived(target.k)
  const tbx = $derived(target.bx)
  const tby = $derived(target.by)
  const cam = camera(
    () => ({ k: tk, bx: tbx, by: tby }),
    () => `${width}x${height}/${scene.key}/${board.id}`,
    () => manual
  )
  const k = $derived(cam.current.k)

  const zoom = zoomTransitions({
    stage: () => stage,
    canvas: () => canvas,
    name: () => scene.key,
    drawable: () => true,
    board: () => board,
    width: () => width,
    height: () => height,
    target: () => target,
    view: () => cam.current
  })

  /** A cell's picture now: its video frame while one is playing, else its thumbnail. */
  const source = (s: GridSlot): CellSource | null => {
    const c = scene.cells.get(s.id)
    const a = c?.asset
    if (!a?.w) return null
    return { src: player?.source(s.id) ?? a.thumb, sw: a.w, sh: a.h, settings: c!.settings }
  }

  // Everything a frame is drawn from; the canvas redraws whenever it changes.
  const frame = $derived({
    scene,
    view: cam.current,
    board,
    selected,
    picking,
    dragging,
    hoverCell,
    hoverGap,
    dropCell,
    playerFrame: player?.frame,
    width,
    height
  })
  $effect(() => draw(frame))

  function draw(f = frame) {
    if (!canvas || !f.width) return
    const pw = Math.round(f.width * dpr)
    const ph = Math.round(f.height * dpr)
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw
      canvas.height = ph
    }
    const sel = f.selected
    drawGridStage(canvas.getContext('2d')!, {
      view: f.view,
      dpr,
      board: f.board,
      grid: f.scene.grid,
      layout: f.scene.layout,
      source,
      selected: sel ? { rect: sel.cell.rect, placement: sel.placement, source: source(sel.cell.slot) } : null,
      chrome: !f.picking,
      dragging: f.dragging,
      hoverCell: f.hoverCell && f.hoverCell !== slot ? (cellOf(f.hoverCell)?.rect ?? null) : null,
      hoverGap: f.hoverGap?.rect ?? null,
      dropCell: cellOf(f.dropCell)?.rect ?? null,
      guides
    })
  }

  /** Client coordinates → artboard pixels. */
  function toBoard(clientX: number, clientY: number): Point {
    const r = stage.getBoundingClientRect()
    const v = cam.current
    return { x: (clientX - r.left - v.bx) / v.k, y: (clientY - r.top - v.by) / v.k }
  }
  const cellAt = (pt: Point) => layout.cells.find((c) => pt.x >= c.rect.x && pt.x <= c.rect.x + c.rect.w && pt.y >= c.rect.y && pt.y <= c.rect.y + c.rect.h)

  type Hit = { kind: 'media'; mode: Mode; cursor: string } | { kind: 'gap'; gap: GridDivider } | { kind: 'cell'; slot: string } | { kind: 'none' }
  /**
   * What a press at `pt` would grab: the selected cell's handles first, then a gap, then the
   * selected cell's media (its overflow too), then any cell.
   */
  function hit(pt: Point): Hit {
    const sel = selected
    const media = sel?.local ? hitTest(sel.local, cellBoard(sel.cell.rect), { x: pt.x - sel.cell.rect.x, y: pt.y - sel.cell.rect.y }, k, true) : null
    if (media && (media.mode.kind === 'scale' || media.mode.kind === 'rotate')) return { kind: 'media', ...media }
    const gap = gapAt(layout, pt, k)
    if (gap) return { kind: 'gap', gap }
    if (media && media.mode.kind === 'move') return { kind: 'media', ...media }
    const cell = cellAt(pt)
    return cell ? { kind: 'cell', slot: cell.slot.id } : { kind: 'none' }
  }

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

  // Wheel, pinch and two-finger pans move the view; Alt+scroll scales the selected cell's media.
  const nav = new WheelNav()
  let wheelIdle: ReturnType<typeof setTimeout> | undefined
  $effect(() => () => clearTimeout(wheelIdle))
  function onwheel(e: WheelEvent) {
    e.preventDefault()
    const sel = selected
    if (e.altKey) {
      if (!sel?.asset?.w) return
      interacting = true
      clearTimeout(wheelIdle)
      wheelIdle = setTimeout(endInteraction, 500)
      const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? height : 1)
      const r = sel.cell.rect
      const at = toBoard(e.clientX, e.clientY)
      const zoom = snapZoom(sel.settings.zoom * Math.exp(-dy * 0.0015), true)
      onEdit(sel.cell.slot.id, zoomAbout(sel.settings, r.w, r.h, sel.asset.w, sel.asset.h, zoom, { x: at.x - r.x, y: at.y - r.y }))
      return
    }
    const g = nav.read(e, stage.getBoundingClientRect())
    if ('zoom' in g) zoomView(g.zoom, g.at.x, g.at.y)
    else panView(g.pan.dx, g.pan.dy)
  }

  useKeymap(SINGLE, {
    fit: () => fitView(),
    zoomIn: () => zoomView(1.25, width / 2, height / 2),
    zoomOut: () => zoomView(0.8, width / 2, height / 2)
  })
  // Esc lets go of the cell first (before the app's Esc goes back to the grid).
  useKeymap(GRID_EDITOR, {
    deselect: { when: () => !!slot, run: () => onSelect(null) },
    remove: { when: () => !!slot, run: () => onRemove() }
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
    hoverGap = h.kind === 'gap' ? h.gap : null
    hoverCell = h.kind === 'cell' ? h.slot : null
    const c = h.kind === 'media' ? h.cursor : h.kind === 'gap' ? (h.gap.dir === 'row' ? 'col-resize' : 'row-resize') : 'default'
    if (c !== cursor) cursor = c
  }

  // Ends a drag still in progress if the view closes mid-drag.
  let endDrag: (() => void) | null = null
  $effect(() => () => endDrag?.())

  /** Mid-drag: shows what the drag is doing (a size, an angle) beside the pointer. */
  function say(text: string | undefined, clientX: number, clientY: number) {
    const r = stage.getBoundingClientRect()
    readout = text ? { x: clientX - r.left + 16, y: clientY - r.top + 16, text } : null
  }

  /** Follows a drag, re-applying it whenever a modifier key changes too. */
  function follow(e: PointerEvent, apply: (clientX: number, clientY: number, mods: Pick<PointerEvent, 'shiftKey' | 'altKey' | 'metaKey' | 'ctrlKey'>) => void) {
    dragging = true
    interacting = true
    let last: Pick<PointerEvent, 'clientX' | 'clientY'> = e
    const run = (x: number, y: number, mods: Pick<PointerEvent, 'shiftKey' | 'altKey' | 'metaKey' | 'ctrlKey'>) => {
      last = { clientX: x, clientY: y }
      apply(x, y, mods)
    }
    const modifiers = (ke: KeyboardEvent) => {
      if (!['Shift', 'Alt', 'Control', 'Meta'].includes(ke.key)) return
      ke.preventDefault()
      run(last.clientX, last.clientY, ke)
    }
    endDrag = trackPointer(e, {
      move: (ev) => run(ev.clientX, ev.clientY, ev),
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
  }

  /** Moving, scaling or rotating a cell's media within its cell. */
  function dragMedia(e: PointerEvent, id: string, mode: Mode) {
    const cell = cellOf(id)
    const c = scene.cells.get(id)
    if (!cell || !c?.asset?.w) return
    const r = cell.rect
    const at = toBoard(e.clientX, e.clientY)
    const start: DragStart = { mode, start: c.settings, board: cellBoard(r), sw: c.asset.w, sh: c.asset.h, k, at: { x: at.x - r.x, y: at.y - r.y } }
    follow(e, (x, y, m) => {
      const pt = toBoard(x, y)
      const res = dragTo(start, { x: pt.x - r.x, y: pt.y - r.y }, { shift: m.shiftKey, alt: m.altKey, mod: m.metaKey || m.ctrlKey })
      // Guides are in the cell; drawn across the board.
      guides = { x: res.guides.x.map((g) => g + r.x), y: res.guides.y.map((g) => g + r.y) }
      say(res.readout, x, y)
      onEdit(id, res.patch)
    })
  }

  /** The content's own shape, for the cells either side of a gap (snapping so it fits uncropped). */
  function aspectsOf(gap: GridDivider): (index: number) => number | null {
    const split = findNode(scene.grid.root, gap.split)
    return (i) => {
      const child = split && isSplit(split) ? split.children[i] : null
      if (!child || isSplit(child)) return null
      const c = scene.cells.get(child.id)
      if (!c?.asset?.w) return null
      return Math.abs(c.settings.rotation % 180) === 90 ? c.asset.h / c.asset.w : c.asset.w / c.asset.h
    }
  }

  function dragGapAt(e: PointerEvent, gap: GridDivider) {
    const aspect = aspectsOf(gap)
    // From the layout as the drag starts: the gap's split keeps its place while its shares change.
    const from = layout
    follow(e, (x, y, m) => {
      const pt = toBoard(x, y)
      const res = dragGap(from, gap, gap.dir === 'row' ? pt.x : pt.y, k, aspect, m.altKey)
      guides = res.guides
      say(res.readout, x, y)
      onArrange(gap.split, res.weights)
    })
  }

  function onpointerdown(e: PointerEvent) {
    // Middle button pans from anywhere.
    if (e.button === 1) {
      e.preventDefault()
      return startPan(e)
    }
    if (e.button !== 0) return
    const h = hit(toBoard(e.clientX, e.clientY))
    if (h.kind === 'none') return startPan(e, () => onSelect(null))
    if (h.kind === 'gap') return dragGapAt(e, h.gap)
    if (h.kind === 'media') return dragMedia(e, slot!, h.mode)
    // Another cell: select it, and its media moves straight away if dragged.
    onSelect(h.slot)
    if (scene.cells.get(h.slot)?.asset?.w) dragMedia(e, h.slot, { kind: 'move' })
  }

  // Double-click: the media's transform back to how its cell frames it; an empty cell, choose what
  // it shows; empty space, back to the grid.
  function ondblclick(e: MouseEvent) {
    const pt = toBoard(e.clientX, e.clientY)
    const cell = cellAt(pt)
    if (!cell) return onExit()
    if (!cell.slot.item) return onChoose(cell.slot.id)
    onReset(cell.slot.id, TRANSFORM)
  }

  function oncontextmenu(e: MouseEvent) {
    e.preventDefault()
    const cell = cellAt(toBoard(e.clientX, e.clientY))
    if (cell) onMenu(cell.slot.id, { x: e.clientX, y: e.clientY })
  }

  // The selected cell's tab, at its top-left corner: drag it onto another cell to swap the two.
  const tab = $derived.by(() => {
    if (!selected || picking) return null
    const v = cam.current
    const r = selected.cell.rect
    return { x: v.bx + r.x * v.k + 6, y: v.by + r.y * v.k + 6, label: selected.asset?.label ?? 'Empty' }
  })
  let tabDrag = $state<{ dx: number; dy: number } | null>(null)
  function ontabdown(e: PointerEvent) {
    if (e.button !== 0 || !slot) return
    e.stopPropagation()
    const from = slot
    trackPointer(e, {
      slop: 3,
      start: () => (dragging = true),
      move: (ev) => {
        tabDrag = { dx: ev.clientX - e.clientX, dy: ev.clientY - e.clientY }
        const c = cellAt(toBoard(ev.clientX, ev.clientY))
        dropCell = c && c.slot.id !== from ? c.slot.id : null
      },
      end: (dragged) => {
        dragging = false
        tabDrag = null
        const to = dropCell
        dropCell = null
        if (!dragged || !to) return
        onSwap(from, to)
        // What was dragged is there now: keep it selected.
        onSelect(to)
      }
    })
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
    hoverCell = null
    hoverGap = null
  }}
  {ondblclick}
  {oncontextmenu}
>
  <canvas bind:this={canvas} data-eyedropper style:width={`${width}px`} style:height={`${height}px`} style:opacity={zoom.entering ? 0 : 1}></canvas>
  {#if tab}
    <button
      class={['cell-tab', { dragging: !!tabDrag }]}
      style:left={`${tab.x}px`}
      style:top={`${tab.y}px`}
      style:transform={tabDrag ? `translate(${tabDrag.dx}px, ${tabDrag.dy}px)` : undefined}
      title="Drag onto another cell to swap them"
      onpointerdown={ontabdown}
      oncontextmenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        if (slot) onMenu(slot, { x: e.clientX, y: e.clientY })
      }}
    >
      <Icon name="grip" size={12} />
      <span>{tab.label}</span>
    </button>
  {/if}
  <button class="zoom-chip" title={manual ? `Fit to view (${hint(SINGLE.actions.fit)})` : 'Fit'} onpointerdown={(e) => e.stopPropagation()} onclick={fitView}>
    {manual ? `${Math.round(k * dpr * 100)}%` : 'Fit'}
  </button>
  {#if readout}<div class="readout" style:left={`${readout.x}px`} style:top={`${readout.y}px`}>{readout.text}</div>{/if}
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

  /* The selected cell's handle for swapping it: a small glass tab on its corner. */
  .cell-tab {
    position: absolute;
    display: flex;
    align-items: center;
    gap: 4px;
    max-width: 180px;
    height: 22px;
    padding: 0 8px 0 4px;
    border-radius: 6px;
    background: var(--glass-bg);
    backdrop-filter: var(--glass-filter);
    box-shadow: var(--glass-shadow);
    color: var(--text);
    font-size: 11px;
    font-weight: 500;
    cursor: grab;
    animation: pop-in 140ms var(--ease) both;
  }

  .cell-tab span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .cell-tab :global(svg) {
    flex: none;
    color: var(--muted);
  }

  .cell-tab.dragging {
    cursor: grabbing;
    pointer-events: none;
    z-index: 3;
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

  /* The value being dragged (a size, an angle), beside the pointer. */
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
