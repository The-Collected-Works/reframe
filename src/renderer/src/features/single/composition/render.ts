import { drawComposition, type Composition, type Layer, type LayerPicture, type LayerSource } from '@shared/composition/compose'
import { corners, drawFrame, type Placement, type Rect } from '@shared/framing/framing'
import type { Guides } from '@shared/framing/snapping'
import type { Artboard } from '@shared/types'
import { themeColor } from '../../../lib/theme'
import type { View } from '../camera.svelte'

const HANDLE = 4.5
/** A cell with nothing in it yet. */
const EMPTY = 'rgba(128, 128, 128, 0.16)'

/** The composition editor's view: the composition (as it is, or as a drag would leave it), and its chrome. */
export interface CompositionFrame<S extends LayerSource = LayerSource> {
  view: View
  dpr: number
  board: Artboard
  /** What's drawn: the composition, its cells where they are right now (moving, mid-drag). */
  composition: Composition<S>
  /** Each layer's picture now (null: drawn empty). */
  picture: (layer: Layer<S>) => LayerPicture | null
  /** Editing chrome shows (not while the eyedropper is open: it needs the exact picture). */
  chrome: boolean
  /** The cells' corner radius, artboard pixels (outlines follow it). */
  radius: number
  /** What's selected: a cell, or a group (with its members, outlined faintly); with several, the rest (`more`). */
  selection: { rect: Rect; group: boolean; members: Rect[]; more: Rect[] } | null
  /** The cell under the pointer. */
  hover: Rect | null
  /** The gap under the pointer (it can be dragged), or being dragged (`active`): a grip on it. */
  hoverGap: { rect: Rect; dir: 'row' | 'col'; active?: boolean } | null
  /** Mid-drag: the groups (faintly), where it would land, and it, under the pointer. */
  structure: Rect[]
  placeholder: Rect | null
  ghost: { x: number; y: number; w: number; h: number; picture: LayerPicture | null } | null
  /** The cell whose picture is being adjusted, with its media's placement (the rest dims). */
  adjusting: { rect: Rect; placement: Placement | null; source: LayerPicture | null } | null
  dragging: boolean
  guides: Guides
}

/** Draws the composition editor: the composition on its board, and whatever chrome is showing. */
export function drawCompositionStage<S extends LayerSource>(ctx: CanvasRenderingContext2D, f: CompositionFrame<S>): void {
  const { view, dpr, board, composition, adjusting } = f
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)
  const kk = view.k * dpr
  const ox = view.bx * dpr
  const oy = view.by * dpr
  const W = board.width
  const H = board.height
  const p = adjusting?.placement ?? null
  const src = adjusting?.source
  const accent = themeColor('--accent')

  /** `r` on screen, grown by `grow` device pixels each side, with the cells' rounding (grown too). */
  const outline = (r: Rect, grow = 0) => {
    const x = ox + r.x * kk - grow
    const y = oy + r.y * kk - grow
    const w = r.w * kk + grow * 2
    const h = r.h * kk + grow * 2
    const rad = Math.max(0, Math.min(f.radius * kk + grow, w / 2, h / 2))
    ctx.beginPath()
    ctx.roundRect(x, y, w, h, rad)
  }

  // The adjusted cell's overflow, faintly, outside its cell.
  if (f.chrome && p && src?.src) {
    ctx.save()
    ctx.globalAlpha = f.dragging ? 0.3 : 0.16
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
  ctx.lineJoin = 'round'

  // Adjusting a cell: everything else steps back.
  if (adjusting) {
    ctx.beginPath()
    ctx.rect(ox, oy, W * kk, H * kk)
    const a = adjusting.rect
    ctx.roundRect(ox + a.x * kk, oy + a.y * kk, a.w * kk, a.h * kk, Math.min(f.radius * kk, (a.w * kk) / 2, (a.h * kk) / 2))
    ctx.fillStyle = 'rgba(8, 8, 10, 0.55)'
    ctx.fill('evenodd')
  }

  // Mid-drag, the groups, faintly: the structure it's being dropped into.
  if (f.structure.length) {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)'
    ctx.lineWidth = dpr
    ctx.setLineDash([4 * dpr, 4 * dpr])
    for (const r of f.structure) {
      outline(r, 5 * dpr)
      ctx.stroke()
    }
    ctx.setLineDash([])
  }

  if (f.hover) {
    ctx.strokeStyle = accent
    ctx.globalAlpha = 0.55
    ctx.lineWidth = 1.5 * dpr
    outline(f.hover, 1.5 * dpr)
    ctx.stroke()
    ctx.globalAlpha = 1
  }

  // The gap under the pointer: a pill along its middle, to grab.
  if (f.hoverGap) {
    const g = f.hoverGap.rect
    const cx = ox + (g.x + g.w / 2) * kk
    const cy = oy + (g.y + g.h / 2) * kk
    const long = Math.min((f.hoverGap.active ? 48 : 36) * dpr, (f.hoverGap.dir === 'row' ? g.h : g.w) * kk * 0.6)
    const [w, h] = f.hoverGap.dir === 'row' ? [4 * dpr, long] : [long, 4 * dpr]
    ctx.fillStyle = accent
    ctx.shadowColor = 'rgba(0, 0, 0, 0.5)'
    ctx.shadowBlur = 4 * dpr
    ctx.beginPath()
    ctx.roundRect(cx - w / 2, cy - h / 2, w, h, 2 * dpr)
    ctx.fill()
    ctx.shadowBlur = 0
  }

  const sel = f.selection
  if (sel && !adjusting) {
    ctx.strokeStyle = accent
    if (sel.group) {
      // A group: tinted, its members outlined faintly inside it.
      ctx.fillStyle = accent
      ctx.globalAlpha = 0.07
      outline(sel.rect, 3 * dpr)
      ctx.fill()
      ctx.globalAlpha = 0.45
      ctx.lineWidth = dpr
      for (const m of sel.members) {
        outline(m, 0.5 * dpr)
        ctx.stroke()
      }
      ctx.globalAlpha = 1
    }
    ctx.lineWidth = 2 * dpr
    ctx.shadowColor = accent
    ctx.shadowBlur = 8 * dpr
    for (const r of [sel.rect, ...sel.more]) {
      outline(r, (sel.group ? 3 : 1.5) * dpr)
      ctx.stroke()
    }
    ctx.shadowBlur = 0
  }

  // Where it would land.
  if (f.placeholder) {
    ctx.fillStyle = accent
    ctx.globalAlpha = 0.12
    outline(f.placeholder, -1 * dpr)
    ctx.fill()
    ctx.globalAlpha = 0.9
    ctx.strokeStyle = accent
    ctx.lineWidth = 1.5 * dpr
    ctx.setLineDash([6 * dpr, 4 * dpr])
    outline(f.placeholder, -1 * dpr)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.globalAlpha = 1
  }

  if (adjusting) {
    // The cell, then its media's transform box and handles.
    ctx.strokeStyle = accent
    ctx.lineWidth = 2 * dpr
    outline(adjusting.rect, 1.5 * dpr)
    ctx.stroke()
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
  ctx.lineWidth = dpr
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

  // What's being dragged, under the pointer: a small card of it.
  const g = f.ghost
  if (g) {
    const x = g.x * dpr
    const y = g.y * dpr
    const w = g.w * dpr
    const h = g.h * dpr
    ctx.save()
    ctx.shadowColor = 'rgba(0, 0, 0, 0.55)'
    ctx.shadowBlur = 18 * dpr
    ctx.shadowOffsetY = 6 * dpr
    ctx.beginPath()
    ctx.roundRect(x, y, w, h, 8 * dpr)
    ctx.fillStyle = '#1c1c20'
    ctx.fill()
    ctx.shadowColor = 'transparent'
    ctx.clip()
    ctx.globalAlpha = 0.92
    if (g.picture?.src && g.picture.sw) {
      ctx.translate(x, y)
      drawFrame(ctx, g.picture.src, g.picture.sw, g.picture.sh, g.w, g.h, g.picture.settings, dpr)
    }
    ctx.restore()
    ctx.save()
    ctx.strokeStyle = accent
    ctx.lineWidth = 2 * dpr
    ctx.beginPath()
    ctx.roundRect(x, y, w, h, 8 * dpr)
    ctx.stroke()
    ctx.restore()
  }
  ctx.restore()
}
