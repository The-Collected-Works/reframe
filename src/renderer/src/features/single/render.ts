import { computePlacement, corners, drawFrame } from '@shared/framing/framing'
import type { Artboard, CropSettings } from '@shared/types'
import { themeColor } from '../../lib/theme'
import type { Guides } from '@shared/framing/snapping'
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
  const p = f.sw ? computePlacement(W, H, f.sw, f.sh, settings) : null

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
