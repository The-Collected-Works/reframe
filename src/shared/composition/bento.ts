import type { Rect } from '../framing/framing'
import type { CompositionItem, BentoNode, Slot, Split, SplitArrangement } from '../types'

/**
 * Bento compositions: cells laid out as a tree of splits, each laying its children side by side or
 * stacked. What's in it (the tree, which item each slot shows, which way each split runs) is the
 * same on every artboard; the proportions are each artboard's own. A split with no direction (Auto)
 * runs whichever way suits its space on each artboard. `arrange` places the cells; compose.ts turns
 * them into the composition's layers. The edits below are plain functions from tree to tree.
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
    const dir = n.dir ?? set?.dir ?? autoDir(r)
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

// ---- editing the tree

/** Which side of a node something goes on. */
export type Side = 'left' | 'right' | 'top' | 'bottom'

/** The way a split runs to put something on `side` of a child: side by side, or stacked. */
export const sideDir = (side: Side): Dir => (side === 'left' || side === 'right' ? 'row' : 'col')
const isAfter = (side: Side) => side === 'right' || side === 'bottom'

/** Which way a split runs: its own direction, or for an Auto one, how it's placed (see `dirsOn`). */
export type DirOf = (split: Split) => Dir

/** Directions as an arrangement placed them (for Auto splits, the way they run on that artboard). */
export const dirsOn =
  (placed: Arrangement): DirOf =>
  (s) =>
    s.dir ?? placed.splits.get(s.id)?.dir ?? 'row'

/** A node added beside another takes half of that one's share (see `reconcileWeights`). */
export interface Born {
  id: string
  from: string
}

/**
 * `node` put on `side` of node `target`. If the split around the target already runs that way, the
 * node joins it there; otherwise the target and the node become a split of their own, running that
 * way, in the target's place.
 */
export function insertBeside(
  root: BentoNode,
  target: string,
  side: Side,
  node: BentoNode,
  dirOf: DirOf,
  newId: () => string
): { root: BentoNode; born?: Born } {
  const dir = sideDir(side)
  const parent = parentOf(root, target)
  if (parent && dirOf(parent) === dir) {
    const i = parent.children.findIndex((c) => c.id === target) + (isAfter(side) ? 1 : 0)
    return {
      root: mapNode(root, parent.id, (p) => ({ ...p, children: [...parent.children.slice(0, i), node, ...parent.children.slice(i)] })),
      born: { id: node.id, from: target }
    }
  }
  return { root: mapNode(root, target, (t) => ({ id: newId(), dir, children: isAfter(side) ? [t, node] : [node, t] })) }
}

/**
 * The tree without node `id` (null: it was the whole tree). A split left with one child gives way
 * to it; and where that leaves a split inside one running the same way (both set), the inner one's
 * children join the outer.
 */
export function removeNode(root: BentoNode, id: string): BentoNode | null {
  if (root.id === id) return null
  const parent = parentOf(root, id)!
  const rest = parent.children.filter((c) => c.id !== id)
  if (rest.length > 1) return mapNode(root, parent.id, (p) => ({ ...p, children: rest }))
  const only = rest[0]
  const grand = parentOf(root, parent.id)
  if (grand && isSplit(only) && only.dir && only.dir === grand.dir) {
    const i = grand.children.findIndex((c) => c.id === parent.id)
    return mapNode(root, grand.id, (g) => ({ ...g, children: [...grand.children.slice(0, i), ...only.children, ...grand.children.slice(i + 1)] }))
  }
  return mapNode(root, parent.id, () => only)
}

/** Whether `inner` is `outer` or inside it. */
export const within = (root: BentoNode, outer: string, inner: string): boolean => {
  const o = findNode(root, outer)
  return !!o && !!findNode(o, inner)
}

/**
 * Node `id` moved to `side` of node `target` (see `insertBeside`). Moving a node beside itself or
 * into itself changes nothing. If taking it out closes up the split the target was (a group of two),
 * it goes beside what took that split's place.
 */
export function moveNode(root: BentoNode, id: string, target: string, side: Side, dirOf: DirOf, newId: () => string): { root: BentoNode; born?: Born } {
  if (id === target || within(root, id, target)) return { root }
  const node = findNode(root, id)
  const rest = node && removeNode(root, id)
  if (!node || !rest) return { root }
  let at = target
  if (!findNode(rest, target)) {
    const parent = parentOf(root, id)!
    at = parent.children.find((c) => c.id !== id)!.id
  }
  // Directions as they were: the split being moved into hasn't changed shape.
  return insertBeside(rest, at, side, node, (s) => (s.dir ? s.dir : dirOf((findNode(root, s.id) as Split | null) ?? s)), newId)
}

/** Split `id` running the other way (an Auto one, the other way from how it runs now). */
export function flipSplit(root: BentoNode, id: string, dirOf: DirOf): BentoNode {
  return mapNode(root, id, (s) => (isSplit(s) ? { ...s, dir: dirOf(s) === 'row' ? 'col' : 'row' } : s))
}

/** Split `id` running `dir` (undefined: Auto). */
export function setSplitDir(root: BentoNode, id: string, dir: Dir | undefined): BentoNode {
  return mapNode(root, id, (s) => {
    if (!isSplit(s)) return s
    const { dir: _old, ...rest } = s
    return dir ? { ...rest, dir } : rest
  })
}

/** Whether split `id` can be dissolved into the split around it (they run the same way). */
export function canUngroup(root: BentoNode, id: string, dirOf: DirOf): boolean {
  const node = findNode(root, id)
  const parent = parentOf(root, id)
  return !!node && isSplit(node) && !!parent && dirOf(parent) === dirOf(node)
}

/** Split `id` dissolved: its children take its place in the split around it (see `canUngroup`). */
export function ungroup(root: BentoNode, id: string, dirOf: DirOf): BentoNode {
  if (!canUngroup(root, id, dirOf)) return root
  const node = findNode(root, id) as Split
  const parent = parentOf(root, id)!
  const i = parent.children.findIndex((c) => c.id === id)
  return mapNode(root, parent.id, (p) => ({ ...p, children: [...parent.children.slice(0, i), ...node.children, ...parent.children.slice(i + 1)] }))
}

/**
 * One artboard's proportions carried from tree `before` to tree `after`: each split's children keep
 * their shares; a split that took a child's place (wrapping it) takes its share; one whose children
 * were spread into its parent shares its share among them as they were; a node `born` beside
 * another takes half of that one's share. Splits that are gone are dropped.
 */
export function reconcileWeights(
  before: BentoNode,
  after: BentoNode,
  set: Record<string, SplitArrangement> | undefined,
  born?: Born
): Record<string, SplitArrangement> | undefined {
  if (!set) return set
  // Every node's share of the whole in `before`, from the splits' proportions.
  const share = new Map<string, number>()
  const walk = (n: BentoNode, s: number) => {
    share.set(n.id, s)
    if (!isSplit(n)) return
    const w = sharesOf(n, set[n.id])
    n.children.forEach((c, i) => walk(c, s * w[i]))
  }
  walk(before, 1)
  const out: Record<string, SplitArrangement> = {}
  for (const s of splitsOf(after)) {
    const was = set[s.id]
    if (!was) continue
    const { weights: _w, ...rest } = was
    if (!was.weights) {
      out[s.id] = was
      continue
    }
    // Each child's share of the whole as it was (a newcomer: half of what it's born from).
    const of = (c: BentoNode): number | undefined => {
      if (born && c.id === born.id) return (share.get(born.from) ?? 0) / 2
      if (born && c.id === born.from) return (share.get(c.id) ?? 0) / 2
      if (share.has(c.id)) return share.get(c.id)
      // A new split, in the place of a child this split had: that child's share.
      if (isSplit(c)) {
        const had = (findNode(before, s.id) as Split | null)?.children.map((x) => x.id) ?? []
        const took = c.children.find((x) => had.includes(x.id))
        if (took) return share.get(took.id)
      }
      return undefined
    }
    const ws = s.children.map(of)
    const known = ws.filter((x): x is number => x !== undefined && x > 0)
    if (!known.length) {
      if (Object.keys(rest).length) out[s.id] = rest
      continue
    }
    const avg = known.reduce((a, b) => a + b, 0) / known.length
    out[s.id] = { ...rest, weights: ws.map((x) => (x !== undefined && x > 0 ? x : avg)) }
  }
  return Object.keys(out).length ? out : undefined
}
