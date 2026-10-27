import { bounds, computePlacement, fromLocal, normDeg, toLocal, type Point } from './framing'
import type { CropSettings } from '../types'

export const ZOOM_MIN = 0.05
export const ZOOM_MAX = 10

/** Smart-guide lines in artboard pixels: vertical lines at x, horizontal lines at y. */
export interface Guides {
  x: number[]
  y: number[]
}

export const NO_GUIDES: Guides = { x: [], y: [] }

function snapAxis(pos: number, size: number, board: number, thresh: number): { delta: number; lines: number[] } {
  const edges = [pos, pos + size / 2, pos + size]
  const targets = [0, board / 2, board]
  let delta = 0
  let best = thresh
  for (const e of edges) {
    for (const t of targets) {
      if (Math.abs(t - e) < best) {
        best = Math.abs(t - e)
        delta = t - e
      }
    }
  }
  if (best === thresh) return { delta: 0, lines: [] }
  let lines = targets.filter((t) => edges.some((e) => Math.abs(e + delta - t) < 0.5))
  // Both edges flush implies the centre; don't draw it too.
  if (lines.length === 3) lines = [0, board]
  return { delta, lines }
}

/**
 * New offset after dragging by (dx, dy) artboard pixels. The media's bounding box edges and
 * centre snap to the artboard's edges and centre. Shift locks to the dominant axis; alt
 * disables snapping.
 */
export function dragOffset(
  start: CropSettings,
  W: number,
  H: number,
  sw: number,
  sh: number,
  dx: number,
  dy: number,
  thresh: number,
  mods: { shift: boolean; alt: boolean }
): { patch: Pick<CropSettings, 'offsetX' | 'offsetY'>; guides: Guides } {
  if (mods.shift) {
    if (Math.abs(dx) > Math.abs(dy)) dy = 0
    else dx = 0
  }
  const b = bounds(computePlacement(W, H, sw, sh, start))
  const sx = mods.alt ? { delta: 0, lines: [] } : snapAxis(b.x + dx, b.w, W, thresh)
  const sy = mods.alt ? { delta: 0, lines: [] } : snapAxis(b.y + dy, b.h, H, thresh)
  return {
    patch: { offsetX: start.offsetX + (dx + sx.delta) / W, offsetY: start.offsetY + (dy + sy.delta) / H },
    guides: { x: sx.lines, y: sy.lines }
  }
}

/** Applies `patch` while keeping `pivot` (artboard pixels) fixed on the media. */
export function withPivot(
  s: CropSettings,
  W: number,
  H: number,
  sw: number,
  sh: number,
  patch: Partial<CropSettings>,
  pivot: Point
): Partial<CropSettings> & Pick<CropSettings, 'offsetX' | 'offsetY'> {
  const a = computePlacement(W, H, sw, sh, s)
  const b = computePlacement(W, H, sw, sh, { ...s, ...patch })
  const moved = fromLocal(b, toLocal(a, pivot))
  return { ...patch, offsetX: s.offsetX + (pivot.x - moved.x) / W, offsetY: s.offsetY + (pivot.y - moved.y) / H }
}

/** Zoom keeping `pivot` (artboard pixels) fixed on the media. */
export function zoomAbout(
  s: CropSettings,
  W: number,
  H: number,
  sw: number,
  sh: number,
  zoom: number,
  pivot: Point
): Pick<CropSettings, 'zoom' | 'offsetX' | 'offsetY'> {
  return withPivot(s, W, H, sw, sh, { zoom }, pivot) as Pick<CropSettings, 'zoom' | 'offsetX' | 'offsetY'>
}

/**
 * Snaps a scale about `pivot`: every bounding-box edge (and the centre) moves linearly with the
 * ratio, `edge(r) = pivot + (edge(1) - pivot) * r`, so the ratio that lands any of them exactly on
 * an artboard edge or centre can be solved directly. `start` is the bounding box at ratio 1;
 * `axes` limits which directions are scaling (a one-sided stretch only moves one).
 */
export function snapScale(
  W: number,
  H: number,
  start: { x: number; y: number; w: number; h: number },
  pivot: Point,
  ratio: number,
  thresh: number,
  axes: { x: boolean; y: boolean }
): { ratio: number; guides: Guides } | null {
  let best: { ratio: number; d: number } | null = null
  const consider = (edges: number[], p: number, targets: number[]) => {
    for (const e of edges) {
      if (Math.abs(e - p) < 1e-6) continue
      const now = p + (e - p) * ratio
      for (const t of targets) {
        const d = Math.abs(t - now)
        const r = (t - p) / (e - p)
        if (d < thresh && r > 0 && (!best || d < best.d)) best = { ratio: r, d }
      }
    }
  }
  const xs = [start.x, start.x + start.w / 2, start.x + start.w]
  const ys = [start.y, start.y + start.h / 2, start.y + start.h]
  if (axes.x) consider(xs, pivot.x, [0, W / 2, W])
  if (axes.y) consider(ys, pivot.y, [0, H / 2, H])
  if (!best) return null
  const r = (best as { ratio: number }).ratio
  // Every line that now coincides, so simultaneous alignments all show.
  const lines = (edges: number[], p: number, targets: number[], on: boolean) =>
    on ? targets.filter((t) => edges.some((e) => Math.abs(p + (e - p) * r - t) < 0.5)) : []
  return { ratio: r, guides: { x: lines(xs, pivot.x, [0, W / 2, W], axes.x), y: lines(ys, pivot.y, [0, H / 2, H], axes.y) } }
}

/** Rotate keeping the media's centre where it is. */
export function rotateAbout(
  s: CropSettings,
  W: number,
  H: number,
  sw: number,
  sh: number,
  rotation: number
): Pick<CropSettings, 'rotation' | 'offsetX' | 'offsetY'> {
  const a = computePlacement(W, H, sw, sh, s)
  const b = computePlacement(W, H, sw, sh, { ...s, rotation: normDeg(rotation) })
  return { rotation: normDeg(rotation), offsetX: s.offsetX + (a.cx - b.cx) / W, offsetY: s.offsetY + (a.cy - b.cy) / H }
}

/** Snaps to 100% (an exact fit/fill) when close. */
export function snapZoom(z: number, off: boolean): number {
  const v = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z))
  return !off && Math.abs(v - 1) < 0.025 ? 1 : v
}

/** Shift snaps to 15° steps; otherwise right angles are sticky. */
export function snapAngle(deg: number, shift: boolean, off: boolean): number {
  if (shift) return Math.round(deg / 15) * 15
  const right = Math.round(deg / 90) * 90
  return !off && Math.abs(deg - right) < 3 ? right : Math.round(deg * 10) / 10
}
