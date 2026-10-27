<!--
  The bento composition editor: the composition on its artboard, framed by the camera. (Its
  structure is outlined beside it, in the single view's left panel; see Outline.)
  - Click a cell to select it; \ selects the group it's in, Enter what's in a group. The selection
    has a + on each edge, to add a cell there, and a toolbar.
  - Drag a cell (or the selected group, if it's in it) to move it: onto another cell's edge to go
    beside it, onto its middle to swap the two, into the margin to go beside everything. While it's
    dragged the layout shows where it would land, everything else making room. Dragging a row in
    the outline shows the same (`outlineDrag`).
  - Double-click a cell (or Enter) to adjust what it shows, with the same gizmo as a single asset,
    the rest dimmed; Esc, Enter or a click elsewhere is done.
  - Drag a gap to resize the cells either side; double-click it to even them out.
  Takes props; the single view connects it.
-->
<script lang="ts">
  import { untrack } from 'svelte'
  import { cubicOut } from 'svelte/easing'
  import { Tween } from 'svelte/motion'
  import { dirsOn, findNode, isSplit, parentOf, within, type Born, type Gap, type Side } from '@shared/composition/bento'
  import type { Layer, LayerPicture } from '@shared/composition/compose'
  import { bounds, computePlacement, type Placement, type Point, type Rect } from '@shared/framing/framing'
  import { NO_GUIDES, snapZoom, zoomAbout, type Guides } from '@shared/framing/snapping'
  import type { Artboard, BentoNode, CropSettings, SettingKey } from '@shared/types'
  import { COMPOSITION_EDITOR, SINGLE } from '../../../config/keymaps'
  import { trackPointer } from '../../../lib/drag'
  import { hint, useKeymap } from '../../../lib/keymap.svelte'
  import { reducedMotion } from '../../../lib/motion'
  import type { Composed } from '../../../state/composition'
  import type { Asset } from '../../../state/library.svelte'
  import type { Player } from '../../../state/playback.svelte'
  import { Button, Icon } from '../../../ui'
  import { camera, type View } from '../camera.svelte'
  import { dragTo, hitTest, type DragStart, type Mode as GizmoMode } from '../gizmo'
  import { WheelNav } from '../nav'
  import { zoomTransitions } from '../zoom.svelte'
  import { dropAt, landed, type Landing } from './drop'
  import FloatingBar from './FloatingBar.svelte'
  import { dragGap, gapAt } from './gaps'
  import { drawCompositionStage } from './render'

  let {
    board,
    comp,
    node,
    nodes,
    adjusting,
    hover = $bindable(null),
    outlineDrag,
    player,
    picking,
    canUngroup,
    canGroup,
    recompose,
    newId,
    onScale,
    onSelect,
    onToggle,
    onAdjust,
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
    onGroup,
    onChoose,
    onHold,
    onMenu,
    onExit
  }: {
    board: Artboard
    comp: Composed
    /** What's selected: a cell or a group (its id in the tree); with several, the last of `nodes`. */
    node: string | null
    /** Everything selected (shift-click adds). */
    nodes: string[]
    /** The cell whose picture is being adjusted, if any (it's the one selected). */
    adjusting: string | null
    /** The cell or group pointed at, here or in the outline beside the stage. */
    hover?: string | null
    /** A row being dragged in the outline: what, and where it would land (shown here as it would be). */
    outlineDrag: { moving: string; into: { parent: string; index: number } | null } | null
    /** Its videos' playback (a track per video cell, by slot). */
    player: Player | null
    /** The eyedropper is open: no editing chrome, it needs the exact picture. */
    picking: boolean
    canUngroup: (group: string) => boolean
    canGroup: (nodes: string[]) => boolean
    /** The composition as it would be with tree `root` on this artboard (to show a drag before it's let go). */
    recompose: (root: BentoNode, born?: Born) => Composed | null
    /** A new node id (for the group a drag would make, in its preview). */
    newId: () => string
    /** Device pixels per artboard pixel on screen (so how sharp a copy each cell plays from). */
    onScale?: (scale: number) => void
    onSelect: (node: string | null) => void
    /** Added to the selection, or taken out of it. */
    onToggle: (node: string) => void
    onAdjust: (slot: string | null) => void
    onEdit: (slot: string, patch: Partial<CropSettings>) => void
    onReset: (slot: string, keys: SettingKey[]) => void
    /** New shares for one group's children, on this artboard. */
    onArrange: (group: string, weights: number[]) => void
    onEvenOut: (group: string) => void
    onAdd: (target: string, side: Side) => void
    onMove: (node: string, target: string, side: Side) => void
    onSwap: (a: string, b: string) => void
    onRemove: (nodes: string[]) => void
    onFlip: (group: string) => void
    onUngroup: (group: string) => void
    /** Nodes put in a group of their own (see `canGroup`). */
    onGroup: (nodes: string[]) => void
    /** Choose what a cell shows. */
    onChoose: (slot: string) => void
    /** A video cell holding its last frame when it's shorter than the composition (or looping). */
    onHold: (slot: string, hold: boolean) => void
    onMenu: (slot: string, at: { x: number; y: number }) => void
    /** Double-click on empty space: back to the grid. */
    onExit: () => void
  } = $props()

  // The board placed clear of the bottom band (player and filmstrip).
  const MARGIN_X = 48
  const MARGIN_TOP = 48
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
  /** A node's rectangle: a cell's, or a group's. */
  const rectOf = (id: string, a = arrangement): Rect | null => a.cells.find((c) => c.slot.id === id)?.rect ?? a.splits.get(id)?.rect ?? null
  /** A cell's own artboard: the gizmo frames media in it exactly as in a whole artboard. */
  const cellBoard = (r: { w: number; h: number }): Artboard => ({ ...board, width: r.w, height: r.h })

  /** What's selected, and the group it's in. */
  const selectedNode = $derived(node ? findNode(root, node) : null)
  const multi = $derived(nodes.length > 1)
  const parent = $derived(node ? parentOf(root, node) : null)

  // ---- adjusting what a cell shows

  // Selecting anything else is done adjusting.
  $effect(() => {
    if (adjusting && adjusting !== node) onAdjust(null)
  })
  const framing = $derived.by(() => {
    const cell = cellOf(adjusting)
    if (!cell) return null
    const c = layers.get(cell.slot.id)
    const a = c?.source
    const local = a?.w ? computePlacement(cell.rect.w, cell.rect.h, a.w, a.h, c!.settings) : null
    return { cell, asset: a, settings: c!.settings, local, placement: local ? onBoard(local, cell.rect) : null }
  })
  const onBoard = (p: Placement, r: { x: number; y: number }): Placement => ({ ...p, cx: p.cx + r.x, cy: p.cy + r.y })
  /** Starts adjusting cell `id` (selecting it), or stops (null). */
  function adjust(id: string | null) {
    if (id && !layers.get(id)?.source) return
    if (id) onSelect(id)
    onAdjust(id)
  }

  let stage: HTMLDivElement
  let canvas: HTMLCanvasElement
  let width = $state(0)
  let height = $state(0)
  let cursor = $state('default')
  let readout = $state<{ x: number; y: number; text: string } | null>(null)
  let hoverGap = $state<Gap | null>(null)
  let busy = $state(false)
  let guides: Guides = NO_GUIDES

  // ---- moving a cell (or a layer): where it would land, and the layout as that would leave it

  /** Mid-drag: what's moving, where it would land, and the pointer (stage pixels; none from the outline). */
  let cellDrag = $state<{ moving: string; landing: Landing | null; at: Point | null } | null>(null)
  const drag = $derived(
    cellDrag ?? (outlineDrag ? { moving: outlineDrag.moving, at: null, landing: outlineDrag.into && ({ kind: 'into', ...outlineDrag.into } as const) } : null)
  )
  const preview = $derived.by(() => {
    const l = drag?.landing
    if (!drag || !l || l.kind === 'swap') return null
    const r = landed(root, drag.moving, l, dirOf, newId)
    return r.root === root ? null : recompose(r.root, r.born)
  })
  /** What's drawn: the composition as it is, or as the drag would leave it. */
  const shown = $derived(preview ?? comp)

  // Cells glide to wherever they go next (not while a gap's dragged: they follow the pointer exactly).
  const glide = new Tween(1, { duration: 180, easing: cubicOut })
  const targets = $derived(new Map(shown.layers.map((l) => [l.id, l.rect])))
  let from = new Map<string, Rect>()
  let to = new Map<string, Rect>()
  let gapDragging = false
  const sameRect = (a: Rect | undefined, b: Rect) => !!a && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h
  $effect.pre(() => {
    const next = targets
    untrack(() => {
      if (next.size === to.size && [...next].every(([id, r]) => sameRect(to.get(id), r))) return
      const first = !to.size
      from = new Map([...to.keys()].map((id) => [id, placedAt(id)!]))
      to = next
      if (first || gapDragging || reducedMotion()) return void glide.set(1, { duration: 0 })
      glide.set(0, { duration: 0 })
      glide.set(1)
    })
  })
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t
  /** Where cell `id` is drawn right now (gliding to where it goes). */
  function placedAt(id: string): Rect | undefined {
    const b = to.get(id)
    if (!b) return undefined
    const a = from.get(id) ?? b
    const t = glide.current
    return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), w: lerp(a.w, b.w, t), h: lerp(a.h, b.h, t) }
  }

  // Framing: the board centred clear of the bottom band, zoomed out while a cell's being adjusted just
  // enough that its media's corners (the handles) are on screen. Held still while interacting.
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
    held = { k, bx: MARGIN_X + (availW - board.width * k) / 2, by: MARGIN_TOP + (availH - board.height * k) / 2 }
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
  const pictureOf = (l: Layer<Asset> | undefined): LayerPicture | null => {
    const a = l?.source
    if (!l || !a?.w) return null
    return { src: player?.frame(l.id) ?? a.thumb, sw: a.w, sh: a.h, settings: l.settings }
  }
  /**
   * What each cell shows, mid-drag: what's moving leaves its place empty (the placeholder shows where
   * it lands); swapping, the two trade pictures, the one landing as a placeholder.
   */
  function picture(l: Layer<Asset>): LayerPicture | null {
    const d = drag
    if (!d?.landing) return pictureOf(l)
    if (d.landing.kind === 'swap') {
      if (l.id === d.landing.target) return null
      return l.id === d.moving ? pictureOf(layers.get(d.landing.target)) : pictureOf(l)
    }
    return within(root, d.moving, l.id) ? null : pictureOf(l)
  }

  // Everything a frame is drawn from; the canvas redraws whenever it changes.
  const frame = $derived({
    shown,
    glide: glide.current,
    view: cam.current,
    board,
    node,
    nodes,
    framing,
    picking,
    busy,
    hover,
    hoverGap,
    drag,
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
    const d = f.drag
    // A cell where it's drawn right now; a group where it's going.
    const at = (id: string) => placedAt(id) ?? rectOf(id, f.shown.arrangement)
    const sel = f.node && !d ? findNode(root, f.node) : null
    // With several selected, the rest outlined as well.
    const more = d
      ? []
      : f.nodes
          .filter((id) => id !== f.node)
          .map(at)
          .filter((r): r is Rect => !!r)
    const selRect = sel ? at(sel.id) : null
    const moving = d ? findNode(root, d.moving) : null
    const ghostRect = d ? rectOf(d.moving) : null
    // A small card of it: its shape, its longer side 88px at most.
    const ghostScale = ghostRect ? Math.min(88 / Math.max(ghostRect.w, ghostRect.h), f.view.k * 0.5) : 0
    const fr = f.framing
    drawCompositionStage(canvas.getContext('2d')!, {
      view: f.view,
      dpr,
      board: f.board,
      composition: { ...f.shown, layers: f.shown.layers.map((l) => ({ ...l, rect: placedAt(l.id) ?? l.rect })) },
      picture,
      chrome: !f.picking,
      radius: comp.item.radius,
      selection:
        sel && selRect
          ? {
              rect: selRect,
              group: isSplit(sel) && !more.length,
              members: isSplit(sel) && !more.length ? sel.children.map((c) => at(c.id)).filter((r): r is Rect => !!r) : [],
              more
            }
          : null,
      hover: f.hover && !f.nodes.includes(f.hover) && !d && !fr ? at(f.hover) : null,
      hoverGap: f.hoverGap && !fr && !d ? { rect: f.hoverGap.rect, dir: f.hoverGap.dir } : null,
      structure: d ? [...f.shown.arrangement.splits].filter(([id]) => id !== f.shown.item.root.id).map(([, s]) => s.rect) : [],
      placeholder: d?.landing ? at(d.landing.kind === 'swap' ? d.landing.target : d.moving) : null,
      ghost:
        d?.at && ghostRect
          ? {
              x: d.at.x + 12,
              y: d.at.y + 12,
              w: ghostRect.w * ghostScale,
              h: ghostRect.h * ghostScale,
              picture: moving && !isSplit(moving) ? pictureOf(layers.get(moving.id)) : null
            }
          : null,
      adjusting: fr ? { rect: fr.cell.rect, placement: fr.placement, source: pictureOf(layers.get(fr.cell.slot.id)) } : null,
      dragging: f.busy,
      guides
    })
  }

  /** Client coordinates → artboard pixels, and → stage pixels. */
  function toBoard(clientX: number, clientY: number): Point {
    const r = stage.getBoundingClientRect()
    const v = cam.current
    return { x: (clientX - r.left - v.bx) / v.k, y: (clientY - r.top - v.by) / v.k }
  }
  function toStage(clientX: number, clientY: number): Point {
    const r = stage.getBoundingClientRect()
    return { x: clientX - r.left, y: clientY - r.top }
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

  // Wheel, pinch and two-finger pans move the view; Alt+scroll scales the selected cell's media.
  const nav = new WheelNav()
  let wheelIdle: ReturnType<typeof setTimeout> | undefined
  $effect(() => () => clearTimeout(wheelIdle))
  function onwheel(e: WheelEvent) {
    e.preventDefault()
    if (e.altKey) {
      const cell = cellOf(node)
      const c = cell && layers.get(cell.slot.id)
      if (!cell || !c?.source?.w) return
      interacting = true
      clearTimeout(wheelIdle)
      wheelIdle = setTimeout(endInteraction, 500)
      const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? height : 1)
      const r = cell.rect
      const at = toBoard(e.clientX, e.clientY)
      const z = snapZoom(c.settings.zoom * Math.exp(-dy * 0.0015), true)
      onEdit(cell.slot.id, zoomAbout(c.settings, r.w, r.h, c.source.w, c.source.h, z, { x: at.x - r.x, y: at.y - r.y }))
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
  // \ steps out to the group around the selection; Enter steps into a group (or adjusts a cell).
  // Esc is done adjusting, then deselects (before the app's Esc goes back to the grid).
  useKeymap(COMPOSITION_EDITOR, {
    adjust: {
      when: () => !!selectedNode && (isSplit(selectedNode) || !!layers.get(selectedNode.id)?.source),
      run: () => (selectedNode && isSplit(selectedNode) ? onSelect(selectedNode.children[0].id) : adjust(adjusting ? null : node))
    },
    parent: { when: () => !!parent, run: () => parent && onSelect(parent.id) },
    group: { when: () => canGroup(nodes), run: () => onGroup(nodes) },
    ungroup: { when: () => !multi && !!selectedNode && canUngroup(selectedNode.id), run: () => node && onUngroup(node) },
    deselect: { when: () => !!node || !!adjusting, run: () => (adjusting ? adjust(null) : onSelect(null)) },
    remove: { when: () => !!nodes.length && !adjusting, run: () => onRemove(nodes) }
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
    busy = true
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
        busy = false
        gapDragging = false
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

  /** Adjusting a cell: what a press at `pt` grabs of its media (handles or body), if anything. */
  function mediaAt(pt: Point): { gizmo: GizmoMode; cursor: string } | null {
    const f = framing
    const hit = f?.local ? hitTest(f.local, cellBoard(f.cell.rect), { x: pt.x - f.cell.rect.x, y: pt.y - f.cell.rect.y }, k, true) : null
    return hit && hit.mode.kind !== 'none' ? { gizmo: hit.mode, cursor: hit.cursor } : null
  }

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
    const start = arrangement
    gapDragging = true
    follow(e, (x, y, m) => {
      const pt = toBoard(x, y)
      const res = dragGap(start, gap, gap.dir === 'row' ? pt.x : pt.y, k, aspect, m.altKey)
      guides = res.guides
      say(res.readout, x, y)
      onArrange(gap.split, res.weights)
    })
  }

  /**
   * A press on a cell: a click selects it (shift-click adds it to the selection, or takes it out); a
   * drag moves it (or the selected group, if it's in it, unless that's everything), the layout
   * making room wherever it would land.
   */
  function pressCell(e: PointerEvent, id: string) {
    const add = e.shiftKey || e.metaKey || e.ctrlKey
    const inGroup = !multi && !!selectedNode && isSplit(selectedNode) && selectedNode.id !== root.id && within(root, selectedNode.id, id)
    const moving = inGroup ? node! : id
    // Where it lands is found on the layout as the drag began, so cells making room don't move the
    // target out from under the pointer.
    const start = arrangement
    endDrag = trackPointer(e, {
      slop: 4,
      start: () => {
        busy = true
        cursor = 'grabbing'
      },
      move: (ev) => {
        const landing = dropAt(root, start, board.width, board.height, toBoard(ev.clientX, ev.clientY), moving)
        cellDrag = { moving, landing, at: toStage(ev.clientX, ev.clientY) }
      },
      end: (dragged) => {
        endDrag = null
        busy = false
        cursor = 'default'
        const d = drag?.landing
        cellDrag = null
        if (!dragged) return add ? onToggle(id) : onSelect(id)
        if (d?.kind === 'swap') {
          onSwap(moving, d.target)
          // What was dragged is there now: keep it selected.
          onSelect(d.target)
        } else if (d?.kind === 'beside') onMove(moving, d.target, d.side)
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
    if (adjusting) {
      const m = mediaAt(pt)
      if (m) return dragMedia(e, adjusting, m.gizmo)
      // In the cell, past its media: still adjusting. Anywhere else is done.
      const cell = cellAt(pt)
      if (cell?.slot.id === adjusting) return
      adjust(null)
      if (cell) return pressCell(e, cell.slot.id)
      return startPan(e)
    }
    const gap = gapAt(arrangement, pt, k)
    if (gap) return dragGapAt(e, gap)
    const cell = cellAt(pt)
    if (cell) return pressCell(e, cell.slot.id)
    startPan(e, () => onSelect(null))
  }

  function onpointermove(e: PointerEvent) {
    if (busy) return
    const pt = toBoard(e.clientX, e.clientY)
    if (adjusting) {
      hover = null
      hoverGap = null
      const c = mediaAt(pt)?.cursor ?? 'default'
      if (c !== cursor) cursor = c
      return
    }
    const gap = gapAt(arrangement, pt, k)
    hoverGap = gap
    hover = gap ? null : (cellAt(pt)?.slot.id ?? null)
    const c = gap ? (gap.dir === 'row' ? 'col-resize' : 'row-resize') : 'default'
    if (c !== cursor) cursor = c
  }

  // Double-click: a gap evens out its group; an empty cell, choose what it shows; a cell, adjust it
  // (the one being adjusted, back to how its cell frames it). Empty space: the grid.
  function ondblclick(e: MouseEvent) {
    const pt = toBoard(e.clientX, e.clientY)
    if (!adjusting) {
      const gap = gapAt(arrangement, pt, k)
      if (gap) return onEvenOut(gap.split)
    }
    const cell = cellAt(pt)
    if (!cell) return onExit()
    if (!cell.slot.item) return onChoose(cell.slot.id)
    if (adjusting === cell.slot.id) return onReset(cell.slot.id, TRANSFORM)
    adjust(cell.slot.id)
  }

  function oncontextmenu(e: MouseEvent) {
    e.preventDefault()
    const cell = cellAt(toBoard(e.clientX, e.clientY))
    if (cell) onMenu(cell.slot.id, { x: e.clientX, y: e.clientY })
  }

  // What floats over the canvas, in stage pixels (following the camera).
  const quiet = $derived(picking || !!drag || busy)
  /** Around everything selected. */
  const selectedRect = $derived.by((): Rect | null => {
    const rs = nodes.map((id) => rectOf(id)).filter((r): r is Rect => !!r)
    if (!rs.length) return null
    const x = Math.min(...rs.map((r) => r.x))
    const y = Math.min(...rs.map((r) => r.y))
    return { x, y, w: Math.max(...rs.map((r) => r.x + r.w)) - x, h: Math.max(...rs.map((r) => r.y + r.h)) - y }
  })
  const sel = $derived(selectedRect && !quiet ? onScreen(selectedRect, cam.current) : null)
  const empties = $derived(quiet || adjusting ? [] : comp.layers.filter((l) => !l.source).map((l) => ({ id: l.id, at: onScreen(l.rect, cam.current) })))
  const selLayer = $derived(selectedNode && !isSplit(selectedNode) ? layers.get(selectedNode.id) : undefined)
  const groupLabel = $derived(
    selectedNode && isSplit(selectedNode) ? `${dirOf(selectedNode) === 'row' ? 'Side by side' : 'Stacked'} · ${selectedNode.children.length}` : ''
  )
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

  {#if sel && multi}
    <FloatingBar at={sel} stageWidth={width}>
      <span class="label">{nodes.length} selected</span>
      <Button
        icon="group"
        iconSize={14}
        disabled={!canGroup(nodes)}
        title={canGroup(nodes)
          ? `Group them, running the same way as the group they're in (${hint(COMPOSITION_EDITOR.actions.group)})`
          : 'Only cells or groups in the same group, and not all of it, can be grouped'}
        onclick={() => onGroup(nodes)}>Group</Button
      >
      <span class="sep"></span>
      <Button
        variant="icon"
        icon="trash"
        iconSize={14}
        tone="danger"
        title={`Remove them (${hint(COMPOSITION_EDITOR.actions.remove)})`}
        onclick={() => onRemove(nodes)}
      />
    </FloatingBar>
  {:else if sel && selectedNode && !adjusting}
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
        <Icon name="plus" size={11} />
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
          <Button
            variant="icon"
            icon="ungroup"
            iconSize={15}
            title={`Ungroup: spread them into the group around (${hint(COMPOSITION_EDITOR.actions.ungroup)})`}
            onclick={() => onUngroup(selectedNode.id)}
          />
        {/if}
      {:else}
        <Button icon="choose" iconSize={14} onclick={() => onChoose(selectedNode.id)}>{selLayer?.source ? 'Replace…' : 'Choose…'}</Button>
        {#if selLayer?.source}
          <Button
            icon="frameMode"
            iconSize={14}
            title={`Move, scale or rotate what it shows (double-click, or ${hint(COMPOSITION_EDITOR.actions.adjust)})`}
            onclick={() => adjust(selectedNode.id)}>Adjust</Button
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
          title={`Select the group it's in (${hint(COMPOSITION_EDITOR.actions.parent)})`}
          onclick={() => onSelect(parent.id)}
        />
      {/if}
      <Button
        variant="icon"
        icon="trash"
        iconSize={14}
        tone="danger"
        title={`Remove ${isSplit(selectedNode) ? 'the group' : 'the cell'} (${hint(COMPOSITION_EDITOR.actions.remove)})`}
        onclick={() => onRemove([selectedNode.id])}
      />
    </FloatingBar>
  {/if}

  {#if framing && !quiet}
    <FloatingBar at={onScreen(framing.cell.rect, cam.current)} stageWidth={width}>
      <span class="label">Adjusting{framing.asset ? ` ${framing.asset.label}` : ''}</span>
      <Button icon="reset" iconSize={14} title="Back to how its cell frames it (or double-click it)" onclick={() => onReset(framing.cell.slot.id, TRANSFORM)}
        >Reset</Button
      >
      <Button variant="primary" title={`Done (${hint(COMPOSITION_EDITOR.actions.adjust)})`} onclick={() => adjust(null)}>Done</Button>
    </FloatingBar>
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
    color: var(--muted);
    font-size: 12px;
    font-weight: 500;
    transition:
      color var(--t-fast) var(--ease),
      background-color var(--t-fast) var(--ease);
  }

  .choose:hover {
    color: var(--text);
    background: var(--hover);
  }

  /* A + on an edge of the selection, half over it: white, ringed in the accent, filling on hover. */
  .add {
    position: absolute;
    z-index: 3;
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    transform: translate(-50%, -50%);
    background: #fff;
    color: var(--accent);
    box-shadow:
      0 0 0 1.5px var(--accent),
      0 2px 6px rgba(0, 0, 0, 0.45);
    animation: pop-in 160ms var(--ease) both;
    transition:
      transform var(--t-fast) var(--ease),
      background-color var(--t-fast) var(--ease),
      color var(--t-fast) var(--ease);
  }

  .add:hover {
    transform: translate(-50%, -50%) scale(1.2);
    background: var(--accent);
    color: #fff;
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
