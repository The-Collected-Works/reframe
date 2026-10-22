import type { Artboard, CropSettings } from './types'

export const DEFAULT_SETTINGS: CropSettings = {
  fit: 'fill',
  zoom: 1,
  anchorX: 0.5,
  anchorY: 0.5,
  offsetX: 0,
  offsetY: 0,
  rotation: 0,
  flipX: false,
  flipY: false,
  bg: 'color',
  bgColor: '#000000',
  blur: 40,
  mute: false,
  skip: false
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** Media placement on the artboard: centre, unrotated size, and rotation in radians. */
export interface Placement {
  cx: number
  cy: number
  w: number
  h: number
  rot: number
}

export interface Point {
  x: number
  y: number
}

export function resolveSettings(board: Artboard, name: string): CropSettings {
  const o = board.overrides[name]
  return o ? { ...board.defaults, ...o } : board.defaults
}

export const rad = (deg: number): number => (deg * Math.PI) / 180

/** Wraps degrees into (-180, 180]. */
export function normDeg(deg: number): number {
  const d = ((deg % 360) + 360) % 360
  return d > 180 ? d - 360 : d
}

/** Quarter turns when rotation is an exact multiple of 90°, otherwise null. */
export function quarterTurns(deg: number): number | null {
  const q = deg / 90
  return Math.abs(q - Math.round(q)) < 1e-9 ? ((Math.round(q) % 4) + 4) % 4 : null
}

function trig(deg: number): { c: number; s: number } {
  const q = quarterTurns(deg)
  if (q != null) return { c: q % 2 ? 0 : 1, s: q % 2 ? 1 : 0 }
  const t = rad(deg)
  return { c: Math.abs(Math.cos(t)), s: Math.abs(Math.sin(t)) }
}

/** Where the media lands on the artboard, in artboard pixels. */
export function computeLayout(W: number, H: number, sw: number, sh: number, s: CropSettings): Placement {
  const { c, s: n } = trig(s.rotation)
  // Rotated bounding box of the unscaled source.
  const bbw = sw * c + sh * n
  const bbh = sw * n + sh * c
  let kx: number
  let ky: number
  switch (s.fit) {
    case 'fit':
      kx = ky = Math.min(W / bbw, H / bbh)
      break
    case 'width':
      kx = ky = W / bbw
      break
    case 'height':
      kx = ky = H / bbh
      break
    case 'stretch':
      if (n > c) {
        kx = H / sw
        ky = W / sh
      } else {
        kx = W / sw
        ky = H / sh
      }
      break
    default:
      // Smallest scale whose rotated rect still covers the whole board.
      kx = ky = Math.max((W * c + H * n) / sw, (W * n + H * c) / sh)
  }
  const w = sw * kx * s.zoom
  const h = sh * ky * s.zoom
  const bw = w * c + h * n
  const bh = w * n + h * c
  return {
    cx: (W - bw) * s.anchorX + bw / 2 + s.offsetX * W,
    cy: (H - bh) * s.anchorY + bh / 2 + s.offsetY * H,
    w,
    h,
    rot: quarterTurns(s.rotation) != null ? (quarterTurns(s.rotation)! * Math.PI) / 2 : rad(s.rotation)
  }
}

/** Axis-aligned bounds of a placement. */
export function bounds(p: Placement): Rect {
  const c = Math.abs(Math.cos(p.rot))
  const n = Math.abs(Math.sin(p.rot))
  const w = p.w * c + p.h * n
  const h = p.w * n + p.h * c
  return { x: p.cx - w / 2, y: p.cy - h / 2, w, h }
}

/** The four corners (tl, tr, br, bl in media space) in artboard pixels. */
export function corners(p: Placement): Point[] {
  const cos = Math.cos(p.rot)
  const sin = Math.sin(p.rot)
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1]
  ].map(([sx, sy]) => {
    const x = (sx * p.w) / 2
    const y = (sy * p.h) / 2
    return { x: p.cx + x * cos - y * sin, y: p.cy + x * sin + y * cos }
  })
}

/** Artboard point → media-local coordinates (0..1 across the media, before rotation). */
export function toLocal(p: Placement, pt: Point): Point {
  const dx = pt.x - p.cx
  const dy = pt.y - p.cy
  const cos = Math.cos(-p.rot)
  const sin = Math.sin(-p.rot)
  return { x: (dx * cos - dy * sin) / p.w + 0.5, y: (dx * sin + dy * cos) / p.h + 0.5 }
}

export function fromLocal(p: Placement, l: Point): Point {
  const x = (l.x - 0.5) * p.w
  const y = (l.y - 0.5) * p.h
  const cos = Math.cos(p.rot)
  const sin = Math.sin(p.rot)
  return { x: p.cx + x * cos - y * sin, y: p.cy + x * sin + y * cos }
}

/** Cover placement for the blurred background, oversized so blur edges stay outside the board. */
export function blurLayout(W: number, H: number, sw: number, sh: number, blur: number, rotation: number): Placement {
  const m = blur * 2
  const p = computeLayout(W + m * 2, H + m * 2, sw, sh, { ...DEFAULT_SETTINGS, rotation })
  return { ...p, cx: W / 2, cy: H / 2 }
}

/** Integer-pixel plan for ffmpeg (unrotated media): crop source, scale, crop to visible, place on board. */
export interface RasterPlan {
  crop: { x: number; y: number; w: number; h: number }
  scale: { w: number; h: number }
  trim: { x: number; y: number; w: number; h: number }
  place: { x: number; y: number }
}

export function rasterPlan(W: number, H: number, sw: number, sh: number, r: Rect): RasterPlan | null {
  const ix0 = clamp(Math.round(r.x), 0, W)
  const iy0 = clamp(Math.round(r.y), 0, H)
  const ix1 = clamp(Math.round(r.x + r.w), 0, W)
  const iy1 = clamp(Math.round(r.y + r.h), 0, H)
  if (ix1 - ix0 < 1 || iy1 - iy0 < 1) return null
  const kx = r.w / sw
  const ky = r.h / sh
  // Source region covering the visible area, padded to whole source pixels.
  const cx0 = clamp(Math.floor((ix0 - r.x) / kx), 0, sw - 1)
  const cy0 = clamp(Math.floor((iy0 - r.y) / ky), 0, sh - 1)
  const cx1 = clamp(Math.ceil((ix1 - r.x) / kx), cx0 + 1, sw)
  const cy1 = clamp(Math.ceil((iy1 - r.y) / ky), cy0 + 1, sh)
  const scaledW = Math.max(1, Math.round((cx1 - cx0) * kx))
  const scaledH = Math.max(1, Math.round((cy1 - cy0) * ky))
  const px = Math.round(r.x + cx0 * kx)
  const py = Math.round(r.y + cy0 * ky)
  const tx = clamp(ix0 - px, 0, scaledW - 1)
  const ty = clamp(iy0 - py, 0, scaledH - 1)
  return {
    crop: { x: cx0, y: cy0, w: cx1 - cx0, h: cy1 - cy0 },
    scale: { w: scaledW, h: scaledH },
    trim: { x: tx, y: ty, w: Math.min(ix1 - ix0, scaledW - tx), h: Math.min(iy1 - iy0, scaledH - ty) },
    place: { x: ix0, y: iy0 }
  }
}

/** Plan for arbitrary rotation: crop the visible source region, scale, rotate, overlay. */
export interface RotatedPlan {
  crop: { x: number; y: number; w: number; h: number }
  scale: { w: number; h: number }
  out: { w: number; h: number }
  place: { x: number; y: number }
}

export function rotatedPlan(W: number, H: number, sw: number, sh: number, p: Placement): RotatedPlan | null {
  const local = [
    { x: 0, y: 0 },
    { x: W, y: 0 },
    { x: W, y: H },
    { x: 0, y: H }
  ].map((pt) => toLocal(p, pt))
  const xs = local.map((l) => l.x * sw)
  const ys = local.map((l) => l.y * sh)
  // One spare source pixel each side keeps interpolated edges clean.
  const cx0 = clamp(Math.floor(Math.min(...xs)) - 1, 0, sw)
  const cy0 = clamp(Math.floor(Math.min(...ys)) - 1, 0, sh)
  const cx1 = clamp(Math.ceil(Math.max(...xs)) + 1, 0, sw)
  const cy1 = clamp(Math.ceil(Math.max(...ys)) + 1, 0, sh)
  if (cx1 - cx0 < 1 || cy1 - cy0 < 1) return null
  const kx = p.w / sw
  const ky = p.h / sh
  const scaleW = Math.max(1, Math.round((cx1 - cx0) * kx))
  const scaleH = Math.max(1, Math.round((cy1 - cy0) * ky))
  const centre = fromLocal(p, { x: (cx0 + cx1) / 2 / sw, y: (cy0 + cy1) / 2 / sh })
  const c = Math.abs(Math.cos(p.rot))
  const n = Math.abs(Math.sin(p.rot))
  const ow = Math.ceil(scaleW * c + scaleH * n)
  const oh = Math.ceil(scaleW * n + scaleH * c)
  return {
    crop: { x: cx0, y: cy0, w: cx1 - cx0, h: cy1 - cy0 },
    scale: { w: scaleW, h: scaleH },
    out: { w: ow, h: oh },
    place: { x: Math.round(centre.x - ow / 2), y: Math.round(centre.y - oh / 2) }
  }
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

function drawPlaced(ctx: Ctx, src: CanvasImageSource, p: Placement, k: number, flipX: boolean, flipY: boolean) {
  ctx.save()
  ctx.translate(p.cx * k, p.cy * k)
  ctx.rotate(p.rot)
  ctx.scale(flipX ? -1 : 1, flipY ? -1 : 1)
  ctx.drawImage(src, (-p.w * k) / 2, (-p.h * k) / 2, p.w * k, p.h * k)
  ctx.restore()
}

/**
 * Draws one composited frame. `k` maps artboard pixels to canvas pixels, so the same code
 * renders thumbnails, the loupe, and full-resolution exports.
 */
export function drawFrame(
  ctx: Ctx,
  src: CanvasImageSource | null,
  sw: number,
  sh: number,
  W: number,
  H: number,
  s: CropSettings,
  k: number
): void {
  ctx.save()
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.fillStyle = s.bgColor
  ctx.fillRect(0, 0, W * k, H * k)
  if (src) {
    if (s.bg === 'blur') {
      ctx.filter = s.blur > 0 ? `blur(${s.blur * k}px)` : 'none'
      drawPlaced(ctx, src, blurLayout(W, H, sw, sh, s.blur, s.rotation), k, s.flipX, s.flipY)
      ctx.filter = 'none'
    }
    drawPlaced(ctx, src, computeLayout(W, H, sw, sh, s), k, s.flipX, s.flipY)
  }
  ctx.restore()
}
