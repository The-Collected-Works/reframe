import { bounds, computePlacement, corners, fromLocal, quarterTurns, toLocal, type Placement, type Point } from '@shared/framing/framing'
import type { Artboard, CropSettings } from '@shared/types'
import { dragOffset, NO_GUIDES, rotateAbout, snapAngle, snapScale, snapZoom, withPivot, ZOOM_MAX, ZOOM_MIN, type Guides } from '@shared/framing/snapping'

/**
 * The transform gizmo in the single view, as plain geometry: what's under the pointer, and what a
 * drag from there does. Points are in artboard pixels; `k` is screen pixels per artboard pixel.
 */

/** `handle` is the grabbed corner or edge midpoint, in local (0..1) media coordinates. */
export type Mode = { kind: 'none' } | { kind: 'move' } | { kind: 'scale'; handle: Point } | { kind: 'rotate' }

const HIT_HANDLE = 10
/** Distance (screen px) from an edge that grabs it for a one-axis stretch. */
const HIT_EDGE = 6
const HIT_ROTATE = 30

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

/**
 * What a press at `pt` would grab. Selected, the handles, the edges (an invisible handle along
 * each) and a ring outside the corners (rotate) are live, and the ghosted overflow counts as the
 * media; unselected, only the media's visible (in-board) part is, like clipped content in Figma.
 */
export function hitTest(p: Placement, board: Artboard, pt: Point, k: number, selected: boolean): { mode: Mode; cursor: string } {
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
  const inside = onMedia && (selected || (pt.x >= 0 && pt.x <= board.width && pt.y >= 0 && pt.y <= board.height))
  if (selected && !onMedia && dist[i] <= HIT_ROTATE) return { mode: { kind: 'rotate' }, cursor: ROTATE_CURSOR }
  if (inside) return { mode: { kind: 'move' }, cursor: selected ? 'move' : 'default' }
  return { mode: { kind: 'none' }, cursor: 'default' }
}

/** Where a drag started: the settings then, the media's size, and the press in artboard pixels. */
export interface DragStart {
  mode: Mode
  start: CropSettings
  board: Artboard
  sw: number
  sh: number
  k: number
  at: Point
}

export type Modifiers = { shift: boolean; alt: boolean; mod: boolean }

/**
 * The change a drag makes, recomputed from its start each time so modifiers can come and go
 * freely. Move: drag, snapping the media's edges and centre to the board's (Shift locks to an
 * axis, Alt or ⌘/Ctrl turns snapping off). Scale: about the opposite corner or edge (Alt: the
 * centre), keeping the aspect ratio; Shift stretches instead, along whichever axes the handle moves;
 * ⌘/Ctrl turns snapping off. Rotate: about the centre (Shift: 15° steps).
 */
export function dragTo(d: DragStart, pt: Point, mods: Modifiers): { patch: Partial<CropSettings>; guides: Guides; readout?: string } {
  const { mode, start, sw, sh, k } = d
  const W = d.board.width
  const H = d.board.height
  const p0 = computePlacement(W, H, sw, sh, start)
  if (mode.kind === 'move') {
    const r = dragOffset(start, W, H, sw, sh, pt.x - d.at.x, pt.y - d.at.y, 6 / k, { shift: mods.shift, alt: mods.alt || mods.mod })
    return { patch: r.patch, guides: r.guides }
  }
  if (mode.kind === 'rotate') {
    const a0 = Math.atan2(d.at.y - p0.cy, d.at.x - p0.cx)
    const ang = Math.atan2(pt.y - p0.cy, pt.x - p0.cx)
    const patch = rotateAbout(start, W, H, sw, sh, snapAngle(start.rotation + ((ang - a0) * 180) / Math.PI, mods.shift, mods.alt || mods.mod))
    return { patch, guides: NO_GUIDES, readout: `${Math.round(patch.rotation * 10) / 10}°` }
  }
  if (mode.kind !== 'scale') return { patch: {}, guides: NO_GUIDES }
  const h = mode.handle
  const pivotL = mods.alt ? { x: 0.5, y: 0.5 } : { x: 1 - h.x, y: 1 - h.y }
  const pivot = fromLocal(p0, pivotL)
  const free = mods.mod
  if (!mods.shift) {
    const from = fromLocal(p0, h)
    const dx = from.x - pivot.x
    const dy = from.y - pivot.y
    const ratio = Math.max(ZOOM_MIN / start.zoom, ((pt.x - pivot.x) * dx + (pt.y - pivot.y) * dy) / (dx * dx + dy * dy))
    const snapped = free ? null : snapScale(W, H, bounds(p0), pivot, ratio, 6 / k, { x: true, y: true })
    const zoom = Math.min(ZOOM_MAX, snapped ? start.zoom * snapped.ratio : snapZoom(start.zoom * ratio, free))
    // Each branch writes every scale key, so toggling Shift mid-drag swaps cleanly.
    return {
      patch: withPivot(start, W, H, sw, sh, { zoom, scaleX: start.scaleX, scaleY: start.scaleY }, pivot),
      guides: snapped?.guides ?? NO_GUIDES,
      readout: `${Math.round(zoom * 100)}%`
    }
  }
  const l = toLocal(p0, pt)
  const r = {
    x: h.x === 0.5 ? 1 : Math.max(0.02, (l.x - pivotL.x) / (h.x - pivotL.x)),
    y: h.y === 0.5 ? 1 : Math.max(0.02, (l.y - pivotL.y) / (h.y - pivotL.y))
  }
  let guides: Guides = NO_GUIDES
  // At a right angle each media axis runs along a board axis, so each snaps on its own.
  const q = quarterTurns(start.rotation)
  if (q != null && !free) {
    const box = bounds(p0)
    for (const axis of ['x', 'y'] as const) {
      if ((axis === 'x' ? h.x : h.y) === 0.5) continue
      const alongX = (axis === 'x') === (q % 2 === 0)
      const snapped = snapScale(W, H, box, pivot, r[axis], 6 / k, { x: alongX, y: !alongX })
      if (!snapped) continue
      r[axis] = snapped.ratio
      guides = { x: [...guides.x, ...snapped.guides.x], y: [...guides.y, ...snapped.guides.y] }
    }
  }
  const scaleX = start.scaleX * r.x
  const scaleY = start.scaleY * r.y
  const parts = [h.x !== 0.5 && `W ${Math.round(scaleX * 100)}%`, h.y !== 0.5 && `H ${Math.round(scaleY * 100)}%`]
  return {
    patch: withPivot(start, W, H, sw, sh, { zoom: start.zoom, scaleX, scaleY }, pivot),
    guides,
    readout: parts.filter(Boolean).join('  ')
  }
}
