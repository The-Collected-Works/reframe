import type { Gap, Arrangement } from '@shared/composition/bento'
import type { Rect } from '@shared/layout'
import type { Guides } from '../snapping'

/**
 * Dragging the gap between two cells (or two groups of cells) in the composition editor, as plain
 * geometry. Points are in artboard pixels; `k` is screen pixels per artboard pixel.
 */

/** Screen pixels either side of a gap that still grab it (gaps can be thin, or none at all). */
const GRAB = 5
/** Smallest a cell can be dragged to, in artboard pixels. */
const MIN = 16

/** The gap under `pt`, if any. */
export function gapAt(arrangement: Arrangement, pt: { x: number; y: number }, k: number): Gap | null {
  const t = GRAB / k
  for (const d of arrangement.dividers) {
    const r = d.rect
    const hit =
      d.dir === 'row'
        ? pt.x >= r.x - t && pt.x <= r.x + r.w + t && pt.y >= r.y && pt.y <= r.y + r.h
        : pt.y >= r.y - t && pt.y <= r.y + r.h + t && pt.x >= r.x && pt.x <= r.x + r.w
    if (hit) return d
  }
  return null
}

/**
 * New shares for the split a gap belongs to, with the gap's middle dragged to `pos` (x for a gap
 * between side-by-side cells, y between stacked ones). Only the two either side change. Snaps to
 * an even split, to either side's content fitting its cell without cropping (`aspect`: the
 * content's width over height, or null), and into line with other gaps; `free` turns that off.
 */
export function dragGap(
  arrangement: Arrangement,
  d: Gap,
  pos: number,
  k: number,
  aspect: (index: number) => number | null,
  free: boolean
): { weights: number[]; guides: Guides; readout: string } {
  const split = arrangement.splits.get(d.split)!
  const row = d.dir === 'row'
  const i = d.index
  const a = split.rects[i]
  const b = split.rects[i + 1]
  const along = (r: Rect) => (row ? r.w : r.h)
  const across = (r: Rect) => (row ? r.h : r.w)
  const start = row ? a.x : a.y
  const gap = row ? d.rect.w : d.rect.h
  const both = along(a) + along(b)
  const min = Math.min(both / 2, MIN)
  const clamp = (len: number) => Math.max(min, Math.min(both - min, len))
  let len = clamp(pos - gap / 2 - start)

  // Where the gap could snap to, as the first side's length, and what it would mean.
  const candidates: { len: number; label?: string; line?: number }[] = []
  const n = split.shares.length
  const room = (row ? split.rect.w : split.rect.h) - gap * (n - 1)
  candidates.push({ len: both / 2, label: 'Even' })
  candidates.push({ len: room / n, label: 'Even' })
  const ra = aspect(i)
  const rb = aspect(i + 1)
  if (ra) candidates.push({ len: row ? across(a) * ra : across(a) / ra, label: 'Fits' })
  if (rb) candidates.push({ len: both - (row ? across(b) * rb : across(b) / rb), label: 'Fits' })
  for (const o of arrangement.dividers) {
    if (o === d || o.dir !== d.dir) continue
    const mid = row ? o.rect.x + o.rect.w / 2 : o.rect.y + o.rect.h / 2
    candidates.push({ len: mid - gap / 2 - start, line: mid })
  }
  let snapped: (typeof candidates)[number] | null = null
  if (!free) {
    let best = 6 / k
    for (const c of candidates) {
      const dist = Math.abs(c.len - len)
      if (c.len >= min && c.len <= both - min && dist < best) {
        best = dist
        snapped = c
      }
    }
  }
  if (snapped) len = snapped.len

  const total = split.shares[i] + split.shares[i + 1]
  const weights = [...split.shares]
  weights[i] = (total * len) / both
  weights[i + 1] = total - weights[i]
  const mid = start + len + gap / 2
  const guides: Guides = snapped?.line != null ? (row ? { x: [mid], y: [] } : { x: [], y: [mid] }) : { x: [], y: [] }
  const size = (l: number, r: Rect) => (row ? `${Math.round(l)}×${Math.round(r.h)}` : `${Math.round(r.w)}×${Math.round(l)}`)
  const readout = `${size(len, a)}  ·  ${size(both - len, b)}${snapped?.label ? `  ${snapped.label}` : ''}`
  return { weights, guides, readout }
}
