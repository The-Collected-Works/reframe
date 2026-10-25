import { inColor, OUT_COLOR, OUT_TAGS } from './color'
import { blurLayout, bounds, computeLayout, quarterTurns, rasterPlan, rotatedPlan } from './layout'
import type { VideoExportJob } from './types'

const hex = (c: string): string => '0x' + c.replace('#', '').slice(0, 6).padEnd(6, '0')
const rgb = (c: string): [number, number, number] => {
  const n = parseInt(c.replace('#', '').slice(0, 6).padEnd(6, '0'), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

const TRANSPOSE = ['', 'transpose=clock', 'hflip,vflip', 'transpose=cclock']

/**
 * Video filter graph for one export. Mirrors drawFrame() so output matches the preview.
 * Decodes with the source's own colour matrix/range and composites in planar RGB, so the
 * background colour is exact and lines up with the video's pixels; converts to BT.709 at the end.
 */
function filterGraph(job: VideoExportJob): string {
  const { width: W, height: H, settings: s } = job
  const color = hex(s.bgColor)
  const [r, g, b] = rgb(s.bgColor)
  const solid = `crop=2:2:0:0,lutrgb=r=${r}:g=${g}:b=${b},scale=${W}:${H},setsar=1`
  const even = W % 2 || H % 2 ? `,pad=ceil(iw/2)*2:ceil(ih/2)*2:0:0:color=${color}` : ''
  const out = `${even},${OUT_COLOR}[v]`
  const flips = (s.flipX ? ',hflip' : '') + (s.flipY ? ',vflip' : '')
  const base = `scale=${job.srcWidth}:${job.srcHeight}:${inColor(job.color)},format=gbrp,setsar=1${flips}`

  const q = quarterTurns(s.rotation)
  if (q == null) {
    // Arbitrary angle: crop the visible region, scale, rotate with alpha, overlay.
    const { srcWidth: sw, srcHeight: sh } = job
    const placed = computeLayout(W, H, sw, sh, s)
    const plan = rotatedPlan(W, H, sw, sh, placed)
    let bg: string
    if (s.bg === 'blur') {
      const bl = blurLayout(W, H, sw, sh, s.blur, s.rotation)
      const blur = s.blur > 0 ? `,gblur=sigma=${s.blur}` : ''
      bg = `scale=${Math.round(bl.w)}:${Math.round(bl.h)}:flags=bicubic,rotate=a=${bl.rot}:ow=${W}:oh=${H}:c=black${blur}`
    } else {
      bg = solid
    }
    if (!plan) return `[0:v]${base},${bg}${out}`
    const fg =
      `crop=${plan.crop.w}:${plan.crop.h}:${plan.crop.x}:${plan.crop.y},` +
      `scale=${plan.scale.w}:${plan.scale.h}:flags=lanczos,format=gbrap,` +
      `rotate=a=${placed.rot}:ow=${plan.out.w}:oh=${plan.out.h}:c=none`
    return `[0:v]${base},split=2[a][b];[a]${bg}[bg];[b]${fg}[fg];` + `[bg][fg]overlay=${plan.place.x}:${plan.place.y}:format=gbrp${out}`
  }

  // Quarter turns: transpose the source losslessly, then lay out as unrotated.
  const odd = q % 2 === 1
  const sw = odd ? job.srcHeight : job.srcWidth
  const sh = odd ? job.srcWidth : job.srcHeight
  const norm = `${base}${TRANSPOSE[q] ? ',' + TRANSPOSE[q] : ''}`
  // Transposing swaps the media's own axes, so its stretch swaps with them.
  const flat = { ...s, rotation: 0, scaleX: odd ? s.scaleY : s.scaleX, scaleY: odd ? s.scaleX : s.scaleY }
  const plan = rasterPlan(W, H, sw, sh, bounds(computeLayout(W, H, sw, sh, flat)))
  const fg = plan
    ? `crop=${plan.crop.w}:${plan.crop.h}:${plan.crop.x}:${plan.crop.y},` +
      `scale=${plan.scale.w}:${plan.scale.h}:flags=lanczos,` +
      `crop=${plan.trim.w}:${plan.trim.h}:${plan.trim.x}:${plan.trim.y}`
    : null

  if (s.bg === 'blur') {
    const bl = bounds(blurLayout(W, H, sw, sh, s.blur, 0))
    const bw = Math.round(bl.w)
    const bh = Math.round(bl.h)
    const blur = s.blur > 0 ? `,gblur=sigma=${s.blur}` : ''
    const bg = `scale=${bw}:${bh}:flags=bicubic,crop=${W}:${H}:${Math.round((bw - W) / 2)}:${Math.round((bh - H) / 2)}${blur}`
    return fg
      ? `[0:v]${norm},split=2[a][b];[a]${bg}[bg];[b]${fg}[fg];` + `[bg][fg]overlay=${plan!.place.x}:${plan!.place.y}:format=gbrp${out}`
      : `[0:v]${norm},${bg}${out}`
  }
  return fg ? `[0:v]${norm},${fg},pad=${W}:${H}:${plan!.place.x}:${plan!.place.y}:color=${color}${out}` : `[0:v]${norm},${solid}${out}`
}

/** ffmpeg arguments for one video export. */
export function videoArgs(job: VideoExportJob): string[] {
  const { settings: s, clip } = job
  const args = ['-hide_banner', '-y', '-nostats', '-progress', 'pipe:1']
  if (clip.start > 0) args.push('-ss', clip.start.toFixed(3))
  args.push('-i', job.input)
  if (clip.end != null) args.push('-t', Math.max(0.05, clip.end - clip.start).toFixed(3))
  args.push('-filter_complex', filterGraph(job), '-map', '[v]')
  if (s.mute) args.push('-an')
  else args.push('-map', '0:a:0?', '-c:a', 'aac', '-b:a', '192k')
  args.push('-c:v', 'libx264', '-preset', 'medium', '-crf', String(job.crf), '-pix_fmt', 'yuv420p', ...OUT_TAGS, '-movflags', '+faststart', job.output)
  return args
}
