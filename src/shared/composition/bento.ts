import type { Rect } from '../framing/framing'
import type { CompositionItem, BentoNode, Slot, Split, SplitArrangement } from '../types'

/**
 * Bento compositions: cells laid out as a tree of splits, each laying its children side by side or
 * stacked. What's in it (the tree, which item each slot shows) is the same on every artboard; how
 * it's arranged (each split's direction and proportions) is per artboard, and follows the artboard's
 * shape until set. `arrange` places the cells; compose.ts turns them into the composition's layers.
 */

export type Dir = 'row' | 'col'

/** A slot's key in an artboard's overrides (its framing there). */
export const slotKey = (composition: string, slot: string): string => `${composition}/${slot}`

export const isSplit = (n: BentoNode): n is Split => 'children' in n

/** Every slot, in reading order. */
export function slotsOf(n: BentoNode): Slot[] {
  return isSplit(n) ? n.children.flatMap(slotsOf) : [n]
}

/** Every split, outermost first. */
export function splitsOf(n: BentoNode): Split[] {
  return isSplit(n) ? [n, ...n.children.flatMap(splitsOf)] : []
}

export function findNode(n: BentoNode, id: string): BentoNode | null {
  if (n.id === id) return n
  if (!isSplit(n)) return null
  for (const c of n.children) {
    const hit = findNode(c, id)
    if (hit) return hit
  }
  return null
}

export function parentOf(n: BentoNode, id: string): Split | null {
  if (!isSplit(n)) return null
  for (const c of n.children) {
    if (c.id === id) return n
    const hit = parentOf(c, id)
    if (hit) return hit
  }
  return null
}

/** The tree with node `id` replaced by what `fn` returns (the rest is shared, not copied). */
export function mapNode(n: BentoNode, id: string, fn: (n: BentoNode) => BentoNode): BentoNode {
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
 * stacks, so a composition's groups read as rows, left to right then down.
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
 * Where everything in a composition goes on a W×H artboard: each slot's rectangle (whole pixels, edges
 * shared exactly between neighbours), the dividers between them, and how each split was placed.
 */
export function arrange(
  composition: Pick<CompositionItem, 'root' | 'gap' | 'padding'>,
  W: number,
  H: number,
  splits?: Record<string, SplitArrangement>
): Arrangement {
  const out: Arrangement = { cells: [], dividers: [], splits: new Map() }
  const pad = Math.max(0, Math.min(composition.padding, W / 2 - 1, H / 2 - 1))
  const place = (n: BentoNode, r: Rect) => {
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
    const gap = Math.max(0, Math.min(composition.gap, (along - n.children.length) / Math.max(1, n.children.length - 1)))
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
  place(composition.root, { x: pad, y: pad, w: W - pad * 2, h: H - pad * 2 })
  return out
}
