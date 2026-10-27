<!--
  The bento composition editor: the composition on its artboard, framed by the camera, in one of two
  modes.
  - Layout arranges the cells. Click a cell to select it, click again for the group around it. The
    selection has a + on each edge to add a cell there, and a toolbar. Drag a cell (or the selected
    group) onto another cell's edge to put it beside, onto its middle to swap the two, or into the
    margin to put it beside everything. Drag a gap to resize, double-click it to even out.
  - Frame positions what a cell shows, with the same gizmo as a single asset, clipped to its cell.
  Takes props; the single view connects it.
-->
<script module lang="ts">
  /** Layout arranges the cells; Frame positions what a cell shows. */
  export type EditorMode = 'layout' | 'frame'
</script>

<script lang="ts">
  import { dirsOn, findNode, isSplit, parentOf, type Gap, type Side } from '@shared/composition/bento'
  import type { Layer, LayerPicture } from '@shared/composition/compose'
  import { bounds, computePlacement, type Placement, type Point, type Rect } from '@shared/framing/framing'
  import { NO_GUIDES, snapZoom, zoomAbout, type Guides } from '@shared/framing/snapping'
  import type { Artboard, CropSettings, SettingKey } from '@shared/types'
  import { COMPOSITION_EDITOR, SINGLE } from '../../../config/keymaps'
  import { trackPointer } from '../../../lib/drag'
  import { hint, useKeymap } from '../../../lib/keymap.svelte'
  import type { Composed } from '../../../state/composition'
  import type { Asset } from '../../../state/library.svelte'
  import type { Player } from '../../../state/playback.svelte'
  import { Button, Icon, Segmented } from '../../../ui'
  import { camera, type View } from '../camera.svelte'
  import { dragTo, hitTest, type DragStart, type Mode as GizmoMode } from '../gizmo'
  import { WheelNav } from '../nav'
  import { zoomTransitions } from '../zoom.svelte'
  import { dropAt, type Drop } from './drop'
  import FloatingBar from './FloatingBar.svelte'
  import { dragGap, gapAt } from './gaps'
  import { drawCompositionStage } from './render'

  let {
    board,
    comp,
    node,
    mode,
    player,
    picking,
    canUngroup,
    onScale,
    onMode,
    onSelect,
    onEdit,
    onReset,
    onArrange,
    onEvenOut,
    onAdd,
    onMove,
    onSwap,
    onRemove,
    onFlip,
    onUngroup,
    onChoose,
    onHold,
    onMenu,
    onExit
  }: {
    board: Artboard
    comp: Composed
    /** What's selected: a cell or a group (its id in the tree). */
    node: string | null
    mode: EditorMode
    /** Its videos' playback (a track per video cell, by slot). */
    player: Player | null
    /** The eyedropper is open: no editing chrome, it needs the exact picture. */
    picking: boolean
    canUngroup: (group: string) => boolean
    /** Device pixels per artboard pixel on screen (so how sharp a copy each cell plays from). */
    onScale?: (scale: number) => void
    onMode: (mode: EditorMode) => void
    onSelect: (node: string | null) => void
    onEdit: (slot: string, patch: Partial<CropSettings>) => void
    onReset: (slot: string, keys: SettingKey[]) => void
    /** New shares for one group's children, on this artboard. */
    onArrange: (group: string, weights: number[]) => void
    onEvenOut: (group: string) => void
    onAdd: (target: string, side: Side) => void
    onMove: (node: string, target: string, side: Side) => void
    onSwap: (a: string, b: string) => void
    onRemove: (node: string) => void
    onFlip: (group: string) => void
    onUngroup: (group: string) => void
    /** Choose what a cell shows. */
    onChoose: (slot: string) => void
    /** A video cell holding its last frame when it's shorter than the composition (or looping). */
    onHold: (slot: string, hold: boolean) => void
    onMenu: (slot: string, at: { x: number; y: number }) => void
    /** Double-click on empty space: back to the grid. */
    onExit: () => void
  } = $props()

  // As the asset stage: the board placed clear of the bottom band (player and filmstrip).
  const MARGIN_X = 48
  const MARGIN_TOP = 56
  const RESERVED = 12 + 64 + 12 + 44 + 12 * 2
  const dpr = window.devicePixelRatio || 1
  const TRANSFORM: SettingKey[] = ['zoom', 'scaleX', 'scaleY', 'offsetX', 'offsetY', 'rotation']
  const SIDES: { side: Side; title: string }[] = [
    { side: 'left', title: 'Add a cell to the left' },
    { side: 'right', title: 'Add a cell to the right' },
    { side: 'top', title: 'Add a cell above' },
    { side: 'bottom', title: 'Add a cell below' }
  ]

  const root = $derived(comp.item.root)
  const arrangement = $derived(comp.arrangement)
  const layers = $derived(new Map(comp.layers.map((l) => [l.id, l])))
  const dirOf = $derived(dirsOn(arrangement))
  const cellOf = (id: string | null) => (id ? arrangement.cells.find((c) => c.slot.id === id) : undefined)
  /** A cell's own artboard: the gizmo frames media in it exactly as in a whole artboard. */
  const cellBoard = (r: { w: number; h: number }): Artboard => ({ ...board, width: r.w, height: r.h })

  /** What's selected, where it is, and the group it's in. */
  const selectedNode = $derived(node ? findNode(root, node) : null)
  const selectedRect = $derived.by((): Rect | null => {
    if (!selectedNode) return null
    return isSplit(selectedNode) ? (arrangement.splits.get(selectedNode.id)?.rect ?? null) : (cellOf(selectedNode.id)?.rect ?? null)
  })
  const parent = $derived(node ? parentOf(root, node) : null)

  // Frame mode: the selected cell's media and its gizmo.
  const framing = $derived.by(() => {
    if (mode !== 'frame' || !selectedNode || isSplit(selectedNode)) return null
    const cell = cellOf(selectedNode.id)
    if (!cell) return null
    const c = layers.get(cell.slot.id)
    const a = c?.source
    const local = a?.w ? computePlacement(cell.rect.w, cell.rect.h, a.w, a.h, c!.settings) : null
    return { cell, asset: a, settings: c!.settings, local, placement: local ? onBoard(local, cell.rect) : null }
  })
  const onBoard = (p: Placement, r: { x: number; y: number }): Placement => ({ ...p, cx: p.cx + r.x, cy: p.cy + r.y })

  let stage: HTMLDivElement
  let canvas: HTMLCanvasElement
  let width = $state(0)
  let height = $state(0)
  let cursor = $state('default')
  let readout = $state<{ x: number; y: number; text: string } | null>(null)
  let hover = $state<string | null>(null)
  let hoverGap = $state<Gap | null>(null)
  let drop = $state<Drop | null>(null)
  let dragging = $state(false)
  let guides: Guides = NO_GUIDES

  // Framing: the board centred, zoomed out while a cell is being framed just enough that its media's
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
    if (framing?.placement) {
      const b = bounds(framing.placement)
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
  // A new composition goes back to Fit. (By key: the composition object itself is new after every edit.)
  const compKey = $derived(comp.key)
  let manual = $derived.by((): View | null => {
    void compKey
    return null
  })
  const tk = $derived(target.k)
  const tbx = $derived(target.bx)
  const tby = $derived(target.by)
  const cam = camera(
    () => ({ k: tk, bx: tbx, by: tby }),
    () => `${width}x${height}/${comp.key}/${board.id}`,
    () => manual
  )
  const k = $derived(cam.current.k)
  $effect(() => onScale?.(k * dpr))

  const zoom = zoomTransitions({
    stage: () => stage,
    canvas: () => canvas,
    name: () => comp.key,
    drawable: () => true,
    board: () => board,
    width: () => width,
    height: () => height,
    target: () => target,
    view: () => cam.current
  })

  /** A cell's picture now: its video frame while one is playing, else its thumbnail. */
  const picture = (l: Layer<Asset> | undefined): LayerPicture | null => {
    const a = l?.source
    if (!l || !a?.w) return null
    return { src: player?.frame(l.id) ?? a.thumb, sw: a.w, sh: a.h, settings: l.settings }
  }

  // Everything a frame is drawn from; the canvas redraws whenever it changes.
  const frame = $derived({
    comp,
    view: cam.current,
    board,
    mode,
    framing,
    selectedRect,
    picking,
    dragging,
    hover,
    hoverGap,
    drop,
    // A new frame to show, or the clock moving (paused, the exact frames are for one time only).
    frames: player?.version,
    time: player?.time,
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
    const fr = f.framing
    const layout = f.mode === 'layout'
    drawCompositionStage(canvas.getContext('2d')!, {
      view: f.view,
      dpr,
      board: f.board,
      composition: f.comp,
      picture,
      chrome: !f.picking,
      framing: fr ? { rect: fr.cell.rect, placement: fr.placement, source: picture(layers.get(fr.cell.slot.id)) } : null,
      outline: layout ? f.selectedRect : null,
      hover: layout && f.hover && f.hover !== node && !f.dragging ? (cellOf(f.hover)?.rect ?? null) : null,
      hoverGap: layout ? (f.hoverGap?.rect ?? null) : null,
      drop: f.drop,
      dragging: f.dragging,
      guides
    })
  }

  /** Client coordinates → artboard pixels. */
  function toBoard(clientX: number, clientY: number): Point {
    const r = stage.getBoundingClientRect()
    const v = cam.current
    return { x: (clientX - r.left - v.bx) / v.k, y: (clientY - r.top - v.by) / v.k }
  }
  /** Artboard pixels → stage pixels (for what floats over the canvas). */
  const onScreen = (r: Rect, v = cam.current) => ({ x: v.bx + r.x * v.k, y: v.by + r.y * v.k, w: r.w * v.k, h: r.h * v.k })
  const cellAt = (pt: Point) =>
    arrangement.cells.find((c) => pt.x >= c.rect.x && pt.x <= c.rect.x + c.rect.w && pt.y >= c.rect.y && pt.y <= c.rect.y + c.rect.h)

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

  // Wheel, pinch and two-finger pans move the view; Alt+scroll scales the framed cell's media.
  const nav = new WheelNav()
  let wheelIdle: ReturnType<typeof setTimeout> | undefined
  $effect(() => () => clearTimeout(wheelIdle))
  function onwheel(e: WheelEvent) {
    e.preventDefault()
    const sel = framing
    if (e.altKey) {
      if (!sel?.asset?.w) return
      interacting = true
      clearTimeout(wheelIdle)
      wheelIdle = setTimeout(endInteraction, 500)
      const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? height : 1)
      const r = sel.cell.rect
      const at = toBoard(e.clientX, e.clientY)
      const z = snapZoom(sel.settings.zoom * Math.exp(-dy * 0.0015), true)
      onEdit(sel.cell.slot.id, zoomAbout(sel.settings, r.w, r.h, sel.asset.w, sel.asset.h, z, { x: at.x - r.x, y: at.y - r.y }))
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
  // Esc steps out: to the group around the selection, then to nothing (before the app's Esc goes
  // back to the grid).
  useKeymap(COMPOSITION_EDITOR, {
    deselect: { when: () => !!node, run: () => onSelect(parent?.id ?? null) },
    remove: { when: () => !!node, run: () => node && onRemove(node) },
    layout: () => onMode('layout'),
    frame: () => onMode('frame')
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

  // ---- Frame mode

  /** Moving, scaling or rotating a cell's media within its cell. */
  function dragMedia(e: PointerEvent, id: string, gizmo: GizmoMode) {
    const cell = cellOf(id)
    const c = layers.get(id)
    if (!cell || !c?.source?.w) return
    const r = cell.rect
    const at = toBoard(e.clientX, e.clientY)
    const start: DragStart = { mode: gizmo, start: c.settings, board: cellBoard(r), sw: c.source.w, sh: c.source.h, k, at: { x: at.x - r.x, y: at.y - r.y } }
    follow(e, (x, y, m) => {
      const pt = toBoard(x, y)
      const res = dragTo(start, { x: pt.x - r.x, y: pt.y - r.y }, { shift: m.shiftKey, alt: m.altKey, mod: m.metaKey || m.ctrlKey })
      // Guides are in the cell; drawn across the board.
      guides = { x: res.guides.x.map((g) => g + r.x), y: res.guides.y.map((g) => g + r.y) }
      say(res.readout, x, y)
      onEdit(id, res.patch)
    })
  }

  /** In Frame mode, what a press at `pt` grabs: the framed media's handles or body, or a cell. */
  function frameHit(pt: Point): { kind: 'media'; gizmo: GizmoMode; cursor: string } | { kind: 'cell'; slot: string } | { kind: 'none' } {
    const sel = framing
    const media = sel?.local ? hitTest(sel.local, cellBoard(sel.cell.rect), { x: pt.x - sel.cell.rect.x, y: pt.y - sel.cell.rect.y }, k, true) : null
    if (media && media.mode.kind !== 'none') return { kind: 'media', gizmo: media.mode, cursor: media.cursor }
    const cell = cellAt(pt)
    return cell ? { kind: 'cell', slot: cell.slot.id } : { kind: 'none' }
  }

  // ---- Layout mode

  /** The content's own shape, for the cells either side of a gap (snapping so it fits uncropped). */
  function aspectsOf(gap: Gap): (index: number) => number | null {
    const split = findNode(root, gap.split)
    return (i) => {
      const child = split && isSplit(split) ? split.children[i] : null
      if (!child || isSplit(child)) return null
      const c = layers.get(child.id)
      if (!c?.source?.w) return null
      return Math.abs(c.settings.rotation % 180) === 90 ? c.source.h / c.source.w : c.source.w / c.source.h
    }
  }

  function dragGapAt(e: PointerEvent, gap: Gap) {
    const aspect = aspectsOf(gap)
    // From the arrangement as the drag starts: the gap's split keeps its place while its shares change.
    const from = arrangement
    follow(e, (x, y, m) => {
      const pt = toBoard(x, y)
      const res = dragGap(from, gap, gap.dir === 'row' ? pt.x : pt.y, k, aspect, m.altKey)
      guides = res.guides
      say(res.readout, x, y)
      onArrange(gap.split, res.weights)
    })
  }

  /**
   * A press on a cell: a click selects it (again, the group around it; inside the selected group,
   * that cell); a drag moves it (or the selected group, if it's in it, unless that's everything) to
   * wherever it's let go.
   */
  function pressCell(e: PointerEvent, id: string) {
    const inGroup = !!selectedNode && isSplit(selectedNode) && selectedNode.id !== root.id && !!findNode(selectedNode, id)
    const moving = inGroup ? node! : id
    trackPointer(e, {
      slop: 4,
      start: () => {
        dragging = true
        cursor = 'grabbing'
      },
      move: (ev) => (drop = dropAt(root, arrangement, board.width, board.height, toBoard(ev.clientX, ev.clientY), moving)),
      end: (dragged) => {
        dragging = false
        cursor = 'default'
        const d = drop
        drop = null
        if (!dragged) return onSelect(node === id ? (parent?.id ?? id) : id)
        if (!d) return
        if (d.kind === 'swap') {
          onSwap(moving, d.target)
          // What was dragged is there now: keep it selected.
          onSelect(d.target)
        } else onMove(moving, d.target, d.side)
      }
    })
  }

  function onpointerdown(e: PointerEvent) {
    // Middle button pans from anywhere.
    if (e.button === 1) {
      e.preventDefault()
      return startPan(e)
    }
    if (e.button !== 0) return
    const pt = toBoard(e.clientX, e.clientY)
    if (mode === 'frame') {
      const h = frameHit(pt)
      if (h.kind === 'none') return startPan(e, () => onSelect(null))
      if (h.kind === 'media') return dragMedia(e, node!, h.gizmo)
      // Another cell: select it, and its media moves straight away if dragged.
      onSelect(h.slot)
      if (layers.get(h.slot)?.source?.w) dragMedia(e, h.slot, { kind: 'move' })
      return
    }
    const gap = gapAt(arrangement, pt, k)
    if (gap) return dragGapAt(e, gap)
    const cell = cellAt(pt)
    if (cell) return pressCell(e, cell.slot.id)
    startPan(e, () => onSelect(null))
  }

  function onpointermove(e: PointerEvent) {
    if (dragging) return
    const pt = toBoard(e.clientX, e.clientY)
    if (mode === 'frame') {
      const h = frameHit(pt)
      hover = null
      hoverGap = null
      const c = h.kind === 'media' ? h.cursor : 'default'
      if (c !== cursor) cursor = c
      return
    }
    const gap = gapAt(arrangement, pt, k)
    hoverGap = gap
    hover = gap ? null : (cellAt(pt)?.slot.id ?? null)
    const c = gap ? (gap.dir === 'row' ? 'col-resize' : 'row-resize') : hover ? 'grab' : 'default'
    if (c !== cursor) cursor = c
  }

  // Double-click. Layout: a gap evens out its group; an empty cell, choose what it shows; a cell,
  // frame it. Frame: the media's transform back to how its cell frames it. Empty space: the grid.
  function ondblclick(e: MouseEvent) {
    const pt = toBoard(e.clientX, e.clientY)
    if (mode === 'layout') {
      const gap = gapAt(arrangement, pt, k)
      if (gap) return onEvenOut(gap.split)
    }
    const cell = cellAt(pt)
    if (!cell) return onExit()
    if (!cell.slot.item) return onChoose(cell.slot.id)
    if (mode === 'layout') {
      onSelect(cell.slot.id)
      return onMode('frame')
    }
    onReset(cell.slot.id, TRANSFORM)
  }

  function oncontextmenu(e: MouseEvent) {
    e.preventDefault()
    const cell = cellAt(toBoard(e.clientX, e.clientY))
    if (cell) onMenu(cell.slot.id, { x: e.clientX, y: e.clientY })
  }

  // What floats over the canvas, in stage pixels (following the camera).
  const sel = $derived(selectedRect && !picking && !dragging ? onScreen(selectedRect, cam.current) : null)
  const empties = $derived(picking ? [] : comp.layers.filter((l) => !l.source).map((l) => ({ id: l.id, at: onScreen(l.rect, cam.current) })))
  const selLayer = $derived(selectedNode && !isSplit(selectedNode) ? layers.get(selectedNode.id) : undefined)
  const groupLabel = $derived.by(() => {
    if (!selectedNode || !isSplit(selectedNode)) return ''
    const n = selectedNode.children.length
    const dir = dirOf(selectedNode)
    return `${dir === 'row' ? 'Row' : 'Column'} of ${n}${selectedNode.dir ? '' : ' · Auto'}`
  })
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
    hover = null
    hoverGap = null
  }}
  {ondblclick}
  {oncontextmenu}
>
  <canvas bind:this={canvas} data-eyedropper style:width={`${width}px`} style:height={`${height}px`} style:opacity={zoom.entering ? 0 : 1}></canvas>

  {#if !picking}
    <div class="modes" role="presentation" onpointerdown={(e) => e.stopPropagation()}>
      <Segmented
        value={mode}
        options={[
          { value: 'layout', icon: 'layoutMode', label: 'Layout', title: `Arrange the cells (${hint(COMPOSITION_EDITOR.actions.layout)})` },
          { value: 'frame', icon: 'frameMode', label: 'Frame', title: `Position what a cell shows (${hint(COMPOSITION_EDITOR.actions.frame)})` }
        ]}
        onChange={onMode}
      />
    </div>
  {/if}

  {#each empties as e (e.id)}
    {#if e.at.w > 40 && e.at.h > 32}
      <button
        class="choose"
        style:left={`${e.at.x + e.at.w / 2}px`}
        style:top={`${e.at.y + e.at.h / 2}px`}
        title="Choose what this cell shows"
        onpointerdown={(ev) => ev.stopPropagation()}
        onclick={() => onChoose(e.id)}
      >
        <Icon name="choose" size={14} />{#if e.at.w > 120}<span>Choose…</span>{/if}
      </button>
    {/if}
  {/each}

  {#if mode === 'layout' && sel && selectedNode}
    <!-- A + on each edge of the selection: a new cell there. -->
    {#each SIDES as s (s.side)}
      <button
        class={['add', s.side]}
        style:left={`${s.side === 'left' ? sel.x : s.side === 'right' ? sel.x + sel.w : sel.x + sel.w / 2}px`}
        style:top={`${s.side === 'top' ? sel.y : s.side === 'bottom' ? sel.y + sel.h : sel.y + sel.h / 2}px`}
        title={s.title}
        aria-label={s.title}
        onpointerdown={(ev) => ev.stopPropagation()}
        onclick={() => onAdd(selectedNode.id, s.side)}
      >
        <Icon name="plus" size={12} />
      </button>
    {/each}

    <FloatingBar at={sel} stageWidth={width}>
      {#if isSplit(selectedNode)}
        <span class="label">{groupLabel}</span>
        <Button
          variant="icon"
          icon="flipDir"
          iconSize={15}
          title={dirOf(selectedNode) === 'row' ? 'Stack them instead' : 'Put them side by side instead'}
          onclick={() => onFlip(selectedNode.id)}
        />
        <Button variant="icon" icon="evenOut" iconSize={15} title="Make them equal (on this artboard)" onclick={() => onEvenOut(selectedNode.id)} />
        {#if canUngroup(selectedNode.id)}
          <Button variant="icon" icon="ungroup" iconSize={15} title="Ungroup: spread them into the group around" onclick={() => onUngroup(selectedNode.id)} />
        {/if}
      {:else}
        <Button icon="choose" iconSize={14} onclick={() => onChoose(selectedNode.id)}>{selLayer?.source ? 'Replace…' : 'Choose…'}</Button>
        {#if selLayer?.source}
          <Button icon="frameMode" iconSize={14} title={`Position what it shows (${hint(COMPOSITION_EDITOR.actions.frame)})`} onclick={() => onMode('frame')}
            >Frame</Button
          >
        {/if}
        {#if selLayer?.source?.kind === 'video'}
          <Button
            variant="icon"
            icon="pause"
            iconSize={14}
            pressed={selLayer.end === 'hold'}
            title="Hold the last frame when it's shorter than the composition (otherwise it loops)"
            onclick={() => onHold(selectedNode.id, selLayer.end !== 'hold')}
          />
        {/if}
      {/if}
      <span class="sep"></span>
      {#if parent}
        <Button
          variant="icon"
          icon="parent"
          iconSize={15}
          title={`Select the group it's in (${hint(COMPOSITION_EDITOR.actions.deselect)})`}
          onclick={() => onSelect(parent.id)}
        />
      {/if}
      <Button
        variant="icon"
        icon="trash"
        iconSize={14}
        tone="danger"
        title={`Remove ${isSplit(selectedNode) ? 'the group' : 'the cell'} (${hint(COMPOSITION_EDITOR.actions.remove)})`}
        onclick={() => onRemove(selectedNode.id)}
      />
    </FloatingBar>
  {/if}

  {#if mode === 'layout' && !node && !picking}
    <div class="hint">Click a cell to select it · drag it onto another to move it · double-click to frame what it shows</div>
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

  .modes {
    position: absolute;
    top: 12px;
    left: 12px;
    z-index: 5;
    padding: 3px;
    border-radius: 10px;
    background: var(--glass-bg);
    backdrop-filter: var(--glass-filter);
    box-shadow: var(--glass-shadow);
    animation: rise-in 300ms var(--ease) 140ms both;
  }

  /* An empty cell's button: choose what it shows. */
  .choose {
    position: absolute;
    z-index: 2;
    display: flex;
    align-items: center;
    gap: 6px;
    height: 28px;
    padding: 0 10px;
    border-radius: 14px;
    transform: translate(-50%, -50%);
    background: var(--glass-bg);
    backdrop-filter: var(--glass-filter);
    box-shadow: var(--glass-shadow);
    color: var(--text);
    font-size: 12px;
    font-weight: 500;
  }

  .choose:hover {
    background: var(--hover);
  }

  /* A + on an edge of the selection: half over it, so it reads as belonging to that edge. */
  .add {
    position: absolute;
    z-index: 3;
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    transform: translate(-50%, -50%);
    background: var(--accent);
    color: #fff;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
    animation: pop-in 140ms var(--ease) both;
    transition: transform var(--t-fast) var(--ease);
  }

  .add:hover {
    transform: translate(-50%, -50%) scale(1.15);
  }

  .hint {
    position: absolute;
    left: 50%;
    top: 56px;
    transform: translateX(-50%);
    padding: 5px 12px;
    border-radius: 12px;
    background: var(--glass-bg);
    backdrop-filter: var(--glass-filter);
    color: var(--muted);
    font-size: 11px;
    white-space: nowrap;
    pointer-events: none;
    animation: rise-in 300ms var(--ease) 400ms both;
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
