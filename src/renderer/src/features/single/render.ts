import { drawBento, type CellSource, type Arrangement } from '@shared/composition/bento'
import { computeLayout, corners, drawFrame, type Placement, type Rect } from '@shared/layout'
import type { Artboard, CropSettings, CompositionItem, Slot } from '@shared/types'
import { themeColor } from '../../lib/theme'
import type { Guides } from '../snapping'
import type { View } from './camera.svelte'

const HANDLE = 4.5

export interface Frame {
  /** The view onto the board, in CSS pixels. */
  view: View
  dpr: number
  board: Artboard
  settings: CropSettings
  /** The media's own size (0 until known) and what to draw of it. */
  sw: number
  sh: number
  source: CanvasImageSource | null
  /** Selected (or being dragged): the overflow ghost, the board edge, the transform box and handles. */
  active: boolean
  /** Dragging: the ghost shows stronger. */
  dragging: boolean
  /** The pointer is over the (unselected) media: a thin outline, like Figma. */
  hover: boolean
  guides: Guides
}

/** Draws the single view: the board with its media, and whatever editing chrome is showing. */
export function drawStage(ctx: CanvasRenderingContext2D, f: Frame): void {
  const { view, dpr, board, settings, source } = f
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)
  const kk = view.k * dpr
  const ox = view.bx * dpr
  const oy = view.by * dpr
  const W = board.width
  const H = board.height
  const p = f.sw ? computeLayout(W, H, f.sw, f.sh, settings) : null

  // Overflow outside the board, faintly.
  if (source && p && f.active) {
    ctx.save()
    ctx.globalAlpha = f.dragging ? 0.3 : 0.14
    ctx.translate(ox + p.cx * kk, oy + p.cy * kk)
    ctx.rotate(p.rot)
    ctx.scale(settings.flipX ? -1 : 1, settings.flipY ? -1 : 1)
    ctx.drawImage(source, (-p.w * kk) / 2, (-p.h * kk) / 2, p.w * kk, p.h * kk)
    ctx.restore()
  }

  ctx.save()
  ctx.translate(ox, oy)
  ctx.beginPath()
  ctx.rect(0, 0, W * kk, H * kk)
  ctx.clip()
  drawFrame(ctx, p ? source : null, f.sw, f.sh, W, H, settings, kk)
  ctx.restore()

  if (!p) return
  const box = corners(p).map((pt) => ({ x: ox + pt.x * kk, y: oy + pt.y * kk }))
  const outline = () => {
    ctx.beginPath()
    box.forEach((pt, i) => (i ? ctx.lineTo(pt.x, pt.y) : ctx.moveTo(pt.x, pt.y)))
    ctx.closePath()
    ctx.stroke()
  }

  if (!f.active) {
    if (!f.hover) return
    ctx.save()
    ctx.lineWidth = dpr
    ctx.strokeStyle = themeColor('--accent')
    outline()
    ctx.restore()
    return
  }

  // Board edge, so it reads against the overflow.
  ctx.strokeStyle = 'rgba(255,255,255,0.28)'
  ctx.lineWidth = dpr
  ctx.strokeRect(Math.round(ox) + 0.5, Math.round(oy) + 0.5, Math.round(W * kk) - 1, Math.round(H * kk) - 1)

  // Transform box and handles.
  ctx.save()
  ctx.lineWidth = dpr
  ctx.strokeStyle = themeColor('--accent')
  outline()
  const hs = HANDLE * dpr
  for (const pt of box) {
    ctx.save()
    ctx.translate(pt.x, pt.y)
    ctx.rotate(p.rot)
    ctx.fillStyle = '#fff'
    ctx.fillRect(-hs, -hs, hs * 2, hs * 2)
    ctx.strokeRect(-hs, -hs, hs * 2, hs * 2)
    ctx.restore()
  }

  // Smart guides.
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

/** The composition editor's view: the composition, and whatever editing chrome is showing. */
export interface CompositionFrame {
  view: View
  dpr: number
  board: Artboard
  composition: CompositionItem
  arrangement: Arrangement
  source: (slot: Slot) => CellSource | null
  /** The cell being edited: its rectangle, and its media's placement there (in artboard pixels). */
  selected: { rect: Rect; placement: Placement | null; source: CellSource | null } | null
  /** Editing chrome shows (not while the eyedropper is open: it needs the exact picture). */
  chrome: boolean
  dragging: boolean
  hoverCell: Rect | null
  hoverGap: Rect | null
  /** Where a dragged cell would swap to. */
  dropCell: Rect | null
  guides: Guides
}

/** A cell with nothing in it yet. */
const EMPTY = 'rgba(128, 128, 128, 0.16)'

/** Draws the composition editor: the composition on its board, empty cells marked, and the selected cell's gizmo. */
export function drawCompositionStage(ctx: CanvasRenderingContext2D, f: CompositionFrame): void {
  const { view, dpr, board, composition, arrangement, selected } = f
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)
  const kk = view.k * dpr
  const ox = view.bx * dpr
  const oy = view.by * dpr
  const W = board.width
  const H = board.height
  const p = selected?.placement ?? null
  const src = selected?.source

  // The selected cell's overflow, faintly, outside its cell.
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
  drawBento(ctx, composition, arrangement, W, H, kk, f.source, EMPTY)
  ctx.restore()
  if (!f.chrome) return

  const box = (r: Rect) => [Math.round(ox + r.x * kk) + 0.5, Math.round(oy + r.y * kk) + 0.5, Math.round(r.w * kk) - 1, Math.round(r.h * kk) - 1] as const
  ctx.save()
  ctx.lineWidth = dpr

  // Empty cells: a plus, to say there's something to put there.
  ctx.strokeStyle = 'rgba(255,255,255,0.35)'
  for (const c of arrangement.cells) {
    if (c.slot.item) continue
    const cx = ox + (c.rect.x + c.rect.w / 2) * kk
    const cy = oy + (c.rect.y + c.rect.h / 2) * kk
    const s = Math.min(10 * dpr, (Math.min(c.rect.w, c.rect.h) * kk) / 4)
    ctx.beginPath()
    ctx.moveTo(cx - s, cy)
    ctx.lineTo(cx + s, cy)
    ctx.moveTo(cx, cy - s)
    ctx.lineTo(cx, cy + s)
    ctx.stroke()
  }

  ctx.strokeStyle = themeColor('--accent')
  if (f.hoverCell) ctx.strokeRect(...box(f.hoverCell))
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
  if (f.dropCell) {
    ctx.globalAlpha = 0.25
    ctx.fillStyle = themeColor('--accent')
    ctx.fillRect(ox + f.dropCell.x * kk, oy + f.dropCell.y * kk, f.dropCell.w * kk, f.dropCell.h * kk)
    ctx.globalAlpha = 1
    ctx.lineWidth = 2 * dpr
    ctx.strokeRect(...box(f.dropCell))
    ctx.lineWidth = dpr
  }

  if (selected) {
    // The cell, then its media's transform box and handles.
    ctx.lineWidth = 2 * dpr
    ctx.strokeRect(...box(selected.rect))
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
