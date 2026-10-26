import { drawFrame, type Rect } from './layout'
import type { CropSettings, LayoutItem, LayoutNode, Slot, Split, SplitArrangement } from './types'

/**
 * Layouts: several items laid out on one artboard. The arrangement is a tree of splits, each laying its
 * children side by side or stacked. What's in it (the tree, which item each slot shows) is the
 * same on every artboard; how it's arranged (each split's direction and proportions) is per
 * artboard, and follows the artboard's shape until set. Shared, so the preview and the export lay
 * out and draw a layout the same way.
 */

export type Dir = 'row' | 'col'

/** A slot's key in an artboard's overrides (its framing there). */
export const slotKey = (layout: string, slot: string): string => `${layout}/${slot}`

export const isSplit = (n: LayoutNode): n is Split => 'children' in n

/** Every slot, in reading order. */
export function slotsOf(n: LayoutNode): Slot[] {
  return isSplit(n) ? n.children.flatMap(slotsOf) : [n]
}

/** Every split, outermost first. */
export function splitsOf(n: LayoutNode): Split[] {
  return isSplit(n) ? [n, ...n.children.flatMap(splitsOf)] : []
}

export function findNode(n: LayoutNode, id: string): LayoutNode | null {
  if (n.id === id) return n
  if (!isSplit(n)) return null
  for (const c of n.children) {
    const hit = findNode(c, id)
    if (hit) return hit
  }
  return null
}

export function parentOf(n: LayoutNode, id: string): Split | null {
  if (!isSplit(n)) return null
  for (const c of n.children) {
    if (c.id === id) return n
    const hit = parentOf(c, id)
    if (hit) return hit
  }
  return null
}

/** The tree with node `id` replaced by what `fn` returns (the rest is shared, not copied). */
export function mapNode(n: LayoutNode, id: string, fn: (n: LayoutNode) => LayoutNode): LayoutNode {
  if (n.id === id) return fn(n)
  if (!isSplit(n)) return n
  const children = n.children.map((c) => mapNode(c, id, fn))
  return children.every((c, i) => c === n.children[i]) ? n : { ...n, children }
}

/** Space each split gives its children (equal unless set), and which way it lays them out. */
export interface PlacedSplit {
  rect: Rect
  dir: Dir
  /** Each child's share, summing to 1. */
  shares: number[]
  /** Its children's rectangles. */
  rects: Rect[]
}

export interface Cell {
  slot: Slot
  /** Whole artboard pixels. */
  rect: Rect
}

/** The gap between two neighbouring children of a split: dragged to share the space differently. */
export interface Gap {
  split: string
  /** Between child `index` and the next. */
  index: number
  dir: Dir
  /** The gap itself, in artboard pixels (zero wide when there's no gap). */
  rect: Rect
}

export interface Arrangement {
  cells: Cell[]
  dividers: Gap[]
  splits: Map<string, PlacedSplit>
}

/**
 * A split's direction where it's given no other: along the longer side of its space. A square one
 * stacks, so a layout's groups read as rows, left to right then down.
 */
export const autoDir = (r: Rect): Dir => (r.w > r.h ? 'row' : 'col')

const validWeights = (w: number[] | undefined, n: number): w is number[] => !!w && w.length === n && w.every((x) => x > 0 && Number.isFinite(x))

/** The shares a split gives its children on an artboard: set there, or equal. */
export function sharesOf(split: Split, set: SplitArrangement | undefined): number[] {
  const n = split.children.length
  const w = validWeights(set?.weights, n) ? set!.weights! : Array<number>(n).fill(1)
  const sum = w.reduce((a, b) => a + b, 0)
  return w.map((x) => x / sum)
}

/**
 * Where everything in a layout goes on a W×H artboard: each slot's rectangle (whole pixels, edges
 * shared exactly between neighbours), the dividers between them, and how each split was placed.
 */
export function arrange(layout: Pick<LayoutItem, 'root' | 'gap' | 'padding'>, W: number, H: number, splits?: Record<string, SplitArrangement>): Arrangement {
  const out: Arrangement = { cells: [], dividers: [], splits: new Map() }
  const pad = Math.max(0, Math.min(layout.padding, W / 2 - 1, H / 2 - 1))
  const place = (n: LayoutNode, r: Rect) => {
    if (!isSplit(n)) {
      const x0 = Math.round(r.x)
      const y0 = Math.round(r.y)
      out.cells.push({ slot: n, rect: { x: x0, y: y0, w: Math.max(1, Math.round(r.x + r.w) - x0), h: Math.max(1, Math.round(r.y + r.h) - y0) } })
      return
    }
    const set = splits?.[n.id]
    const dir = set?.dir ?? autoDir(r)
    const shares = sharesOf(n, set)
    const along = dir === 'row' ? r.w : r.h
    const gap = Math.max(0, Math.min(layout.gap, (along - n.children.length) / Math.max(1, n.children.length - 1)))
    const free = Math.max(0, along - gap * (n.children.length - 1))
    const rects: Rect[] = []
    let at = dir === 'row' ? r.x : r.y
    shares.forEach((s, i) => {
      const len = free * s
      rects.push(dir === 'row' ? { x: at, y: r.y, w: len, h: r.h } : { x: r.x, y: at, w: r.w, h: len })
      at += len
      if (i < shares.length - 1) {
        out.dividers.push({
          split: n.id,
          index: i,
          dir,
          rect: dir === 'row' ? { x: at, y: r.y, w: gap, h: r.h } : { x: r.x, y: at, w: r.w, h: gap }
        })
        at += gap
      }
    })
    out.splits.set(n.id, { rect: r, dir, shares, rects })
    n.children.forEach((c, i) => place(c, rects[i]))
  }
  place(layout.root, { x: pad, y: pad, w: W - pad * 2, h: H - pad * 2 })
  return out
}

/** What a cell shows when drawn: a picture framed by `settings`, or (`hole`) nothing, cut out. */
export interface CellSource {
  src: CanvasImageSource | null
  sw: number
  sh: number
  settings: CropSettings
  hole?: boolean
}

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

export function cellPath(ctx: Ctx, r: Rect, radius: number, k: number): void {
  ctx.beginPath()
  ctx.roundRect(r.x * k, r.y * k, r.w * k, r.h * k, Math.max(0, Math.min(radius, r.w / 2, r.h / 2)) * k)
}

/**
 * Draws a layout: its background, then each cell framed into its (rounded) rectangle. `k` maps
 * artboard pixels to canvas pixels, as for drawFrame. A cell with nothing to show is left as
 * background, or filled with `empty` (the editor's placeholder).
 */
export function drawLayout(
  ctx: Ctx,
  layout: Pick<LayoutItem, 'radius' | 'bgColor'>,
  arrangement: Arrangement,
  W: number,
  H: number,
  k: number,
  source: (slot: Slot) => CellSource | null,
  empty?: string
): void {
  ctx.save()
  ctx.fillStyle = layout.bgColor
  ctx.fillRect(0, 0, W * k, H * k)
  for (const { slot, rect } of arrangement.cells) {
    const s = source(slot)
    cellPath(ctx, rect, layout.radius, k)
    if (s?.hole) {
      ctx.save()
      ctx.globalCompositeOperation = 'destination-out'
      ctx.fill()
      ctx.restore()
    } else if (s && s.sw) {
      ctx.save()
      ctx.clip()
      ctx.translate(rect.x * k, rect.y * k)
      drawFrame(ctx, s.src, s.sw, s.sh, rect.w, rect.h, s.settings, k)
      ctx.restore()
    } else if (empty) {
      ctx.fillStyle = empty
      ctx.fill()
    }
  }
  ctx.restore()
}

// ---- time

/** How long a layout runs: its set duration, or its longest video. 0: no video, so it's a still. */
export function layoutDuration(duration: number | null, lengths: number[]): number {
  if (!lengths.length) return 0
  return Math.max(0.1, duration ?? Math.max(...lengths))
}

/** Where a slot's video is (in its own time) at `t` seconds into the layout. */
export function slotTime(t: number, start: number, length: number, end: 'loop' | 'hold' = 'loop'): number {
  if (length <= 0) return start
  return start + (end === 'hold' ? Math.min(t, Math.max(0, length - 1 / 60)) : t % length)
}
