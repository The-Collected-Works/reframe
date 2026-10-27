import { findNode, within, type Arrangement, type Side } from '@shared/composition/bento'
import type { Rect } from '@shared/framing/framing'
import type { BentoNode } from '@shared/types'

/**
 * Where something dragged in the composition editor would land, as plain geometry: beside a cell
 * (near one of its edges), in its place (near its middle: the two swap), or beside the whole
 * composition (in the margin around the cells). Points are in artboard pixels.
 */

export type Drop = { kind: 'beside'; target: string; side: Side; rect: Rect; zone: Rect } | { kind: 'swap'; target: string; rect: Rect }

/** How far in from a cell's edge (as a share of its size) still means "beside it, on that side". */
const EDGE = 0.3

/** The part of `r` on `side` that a new neighbour there would take (about a third). */
export function zoneOf(r: Rect, side: Side): Rect {
  const w = r.w / 3
  const h = r.h / 3
  if (side === 'left') return { x: r.x, y: r.y, w, h: r.h }
  if (side === 'right') return { x: r.x + r.w - w, y: r.y, w, h: r.h }
  if (side === 'top') return { x: r.x, y: r.y, w: r.w, h }
  return { x: r.x, y: r.y + r.h - h, w: r.w, h }
}

/** The side of `r` nearest `pt`, and how near (as a share of its size). */
function nearest(r: Rect, pt: { x: number; y: number }): { side: Side; d: number } {
  const u = (pt.x - r.x) / r.w
  const v = (pt.y - r.y) / r.h
  const sides: [Side, number][] = [
    ['left', u],
    ['right', 1 - u],
    ['top', v],
    ['bottom', 1 - v]
  ]
  const [side, d] = sides.reduce((a, b) => (b[1] < a[1] ? b : a))
  return { side, d }
}

/**
 * Where node `moving` would land, dropped at `pt` on an arrangement of the tree `root` that's
 * `W`×`H`. Nothing inside what's moving (or the cell itself in its own place) is a target; a group
 * can't swap.
 */
export function dropAt(root: BentoNode, arrangement: Arrangement, W: number, H: number, pt: { x: number; y: number }, moving: string): Drop | null {
  if (pt.x < 0 || pt.y < 0 || pt.x > W || pt.y > H) return null
  const inside = (r: Rect) => pt.x >= r.x && pt.x <= r.x + r.w && pt.y >= r.y && pt.y <= r.y + r.h
  const cells = arrangement.cells
  // Outside every cell but within them all (in a gap between two), the nearest one.
  const bounds = cells.reduce<Rect | null>((u, c) => {
    if (!u) return c.rect
    const x = Math.min(u.x, c.rect.x)
    const y = Math.min(u.y, c.rect.y)
    return { x, y, w: Math.max(u.x + u.w, c.rect.x + c.rect.w) - x, h: Math.max(u.y + u.h, c.rect.y + c.rect.h) - y }
  }, null)
  const distance = (r: Rect) => Math.hypot(Math.max(r.x - pt.x, 0, pt.x - r.x - r.w), Math.max(r.y - pt.y, 0, pt.y - r.y - r.h))
  const cell =
    cells.find((c) => inside(c.rect)) ?? (bounds && inside(bounds) ? cells.reduce((a, b) => (distance(b.rect) < distance(a.rect) ? b : a)) : undefined)
  const isCell = !!findNode(root, moving) && !('children' in findNode(root, moving)!)
  if (cell) {
    if (within(root, moving, cell.slot.id)) return null
    const { side, d } = nearest(cell.rect, pt)
    if (d < EDGE || !isCell || !inside(cell.rect)) return { kind: 'beside', target: cell.slot.id, side, rect: cell.rect, zone: zoneOf(cell.rect, side) }
    return { kind: 'swap', target: cell.slot.id, rect: cell.rect }
  }
  // In the margin around the cells: beside the whole composition, along its nearest edge.
  if (root.id === moving) return null
  const board = { x: 0, y: 0, w: W, h: H }
  const { side } = nearest(board, pt)
  return { kind: 'beside', target: root.id, side, rect: board, zone: zoneOf(board, side) }
}
