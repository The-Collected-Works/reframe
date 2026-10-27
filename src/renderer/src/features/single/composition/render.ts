import { drawComposition, type Composition, type Layer, type LayerPicture, type LayerSource } from '@shared/composition/compose'
import { corners, type Placement, type Rect } from '@shared/framing/framing'
import type { Guides } from '@shared/framing/snapping'
import type { Artboard } from '@shared/types'
import { themeColor } from '../../../lib/theme'
import type { View } from '../camera.svelte'
import type { Drop } from './drop'

const HANDLE = 4.5
/** A cell with nothing in it yet. */
const EMPTY = 'rgba(128, 128, 128, 0.16)'

/** The composition editor's view: the composition, and whatever editing chrome is showing. */
export interface CompositionFrame<S extends LayerSource = LayerSource> {
  view: View
  dpr: number
  board: Artboard
  composition: Composition<S>
  /** Each layer's picture now. */
  picture: (layer: Layer<S>) => LayerPicture | null
  /** Editing chrome shows (not while the eyedropper is open: it needs the exact picture). */
  chrome: boolean
  /** Frame mode: the cell being framed, and its media's placement there (artboard pixels). */
  framing: { rect: Rect; placement: Placement | null; source: LayerPicture | null } | null
  /** Layout mode: what's selected (a cell, or a group of them). */
  outline: Rect | null
  /** The cell under the pointer, and the gap under it (it can be dragged). */
  hover: Rect | null
  hoverGap: Rect | null
  /** Where what's being dragged would land. */
  drop: Drop | null
  dragging: boolean
  guides: Guides
}

/**
 * Draws the composition editor: the composition on its board, and its chrome. In Layout mode, the
 * cell under the pointer, the selected cell or group, and where a dragged one would land; in Frame
 * mode, the cell being framed with its media's gizmo.
 */
export function drawCompositionStage<S extends LayerSource>(ctx: CanvasRenderingContext2D, f: CompositionFrame<S>): void {
  const { view, dpr, board, composition, framing } = f
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)
  const kk = view.k * dpr
  const ox = view.bx * dpr
  const oy = view.by * dpr
  const W = board.width
  const H = board.height
  const p = framing?.placement ?? null
  const src = framing?.source
  const accent = themeColor('--accent')
  const rect = (r: Rect) => [ox + r.x * kk, oy + r.y * kk, r.w * kk, r.h * kk] as const
  const box = (r: Rect) => [Math.round(ox + r.x * kk) + 0.5, Math.round(oy + r.y * kk) + 0.5, Math.round(r.w * kk) - 1, Math.round(r.h * kk) - 1] as const

  // The framed cell's overflow, faintly, outside its cell.
  if (f.chrome && p && src?.src) {
    ctx.save()
    ctx.globalAlpha = f.dragging ? 0.3 : 0.14
    ctx.translate(ox + p.cx * kk, oy + p.cy * kk)
    ctx.rotate(p.rot)
    ctx.scale(src.settings.flipX ? -1 : 1, src.settings.flipY ? -1 : 1)
    ctx.drawImage(src.src, (-p.w * kk) / 2, (-p.h * kk) / 2, p.w * kk, p.h * kk)
    ctx.restore()
  }

  ctx.save()
  ctx.translate(ox, oy)
  ctx.beginPath()
  ctx.rect(0, 0, W * kk, H * kk)
  ctx.clip()
  drawComposition(ctx, composition, kk, f.picture, EMPTY)
  ctx.restore()
  if (!f.chrome) return

  ctx.save()
  ctx.lineWidth = dpr
  ctx.strokeStyle = accent

  if (f.hover) {
    ctx.globalAlpha = 0.5
    ctx.strokeRect(...box(f.hover))
    ctx.globalAlpha = 1
  }
  if (f.hoverGap) {
    // The gap under the pointer: a line along its middle.
    const g = f.hoverGap
    ctx.lineWidth = 2 * dpr
    ctx.beginPath()
    if (g.w <= g.h) {
      const x = ox + (g.x + g.w / 2) * kk
      ctx.moveTo(x, oy + g.y * kk)
      ctx.lineTo(x, oy + (g.y + g.h) * kk)
    } else {
      const y = oy + (g.y + g.h / 2) * kk
      ctx.moveTo(ox + g.x * kk, y)
      ctx.lineTo(ox + (g.x + g.w) * kk, y)
    }
    ctx.stroke()
    ctx.lineWidth = dpr
  }
  if (f.outline) {
    ctx.lineWidth = 2 * dpr
    ctx.strokeRect(...box(f.outline))
    ctx.lineWidth = dpr
  }

  // Where a drag would land: the part of the cell a new neighbour takes, or (swapping) all of it.
  const d = f.drop
  if (d) {
    ctx.fillStyle = accent
    ctx.globalAlpha = d.kind === 'swap' ? 0.25 : 0.35
    ctx.fillRect(...rect(d.kind === 'swap' ? d.rect : d.zone))
    ctx.globalAlpha = 1
    ctx.lineWidth = 2 * dpr
    ctx.strokeRect(...box(d.rect))
    if (d.kind === 'beside') {
      // The edge it goes along, bold.
      ctx.lineWidth = 4 * dpr
      ctx.beginPath()
      const r = d.rect
      const [x0, y0, x1, y1] =
        d.side === 'left'
          ? [r.x, r.y, r.x, r.y + r.h]
          : d.side === 'right'
            ? [r.x + r.w, r.y, r.x + r.w, r.y + r.h]
            : d.side === 'top'
              ? [r.x, r.y, r.x + r.w, r.y]
              : [r.x, r.y + r.h, r.x + r.w, r.y + r.h]
      ctx.moveTo(ox + x0 * kk, oy + y0 * kk)
      ctx.lineTo(ox + x1 * kk, oy + y1 * kk)
      ctx.stroke()
    }
    ctx.lineWidth = dpr
  }

  if (framing) {
    // The cell, then its media's transform box and handles.
    ctx.lineWidth = 2 * dpr
    ctx.strokeRect(...box(framing.rect))
    ctx.lineWidth = dpr
    if (p) {
      const pts = corners(p).map((pt) => ({ x: ox + pt.x * kk, y: oy + pt.y * kk }))
      ctx.beginPath()
      pts.forEach((pt, i) => (i ? ctx.lineTo(pt.x, pt.y) : ctx.moveTo(pt.x, pt.y)))
      ctx.closePath()
      ctx.stroke()
      const hs = HANDLE * dpr
      for (const pt of pts) {
        ctx.save()
        ctx.translate(pt.x, pt.y)
        ctx.rotate(p.rot)
        ctx.fillStyle = '#fff'
        ctx.fillRect(-hs, -hs, hs * 2, hs * 2)
        ctx.strokeRect(-hs, -hs, hs * 2, hs * 2)
        ctx.restore()
      }
    }
  }

  // Smart guides, across the board.
  ctx.strokeStyle = themeColor('--guide')
  const ext = 14 * dpr
  ctx.beginPath()
  for (const x of f.guides.x) {
    const sx = Math.round(ox + x * kk) + 0.5
    ctx.moveTo(sx, oy - ext)
    ctx.lineTo(sx, oy + H * kk + ext)
  }
  for (const y of f.guides.y) {
    const sy = Math.round(oy + y * kk) + 0.5
    ctx.moveTo(ox - ext, sy)
    ctx.lineTo(ox + W * kk + ext, sy)
  }
  ctx.stroke()
  ctx.restore()
}
