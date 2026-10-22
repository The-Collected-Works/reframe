import type { ColorMeta } from './types'

const MATRIX: [RegExp, ColorMeta['matrix']][] = [
  [/bt709/, 'bt709'],
  [/bt470bg|smpte170m|bt601/, 'bt601'],
  [/bt2020/, 'bt2020'],
  [/smpte240m/, 'smpte240m'],
  [/fcc/, 'fcc']
]

/**
 * Colour matrix and range of the first video stream, from `ffmpeg -i` output. Untagged video
 * gets the usual player convention: BT.709 for HD, BT.601 for SD, limited range.
 */
export function parseColor(stderr: string): ColorMeta {
  const line = /Stream #.*Video: .*/.exec(stderr)?.[0] ?? ''
  const fmt = /, (\w+)\(([^)]*)\)/.exec(line)
  const tags = fmt?.[2] ?? ''
  const size = /, (\d{2,5})x(\d{2,5})/.exec(line)
  const w = size ? Number(size[1]) : 1920
  const h = size ? Number(size[2]) : 1080
  const matrix = MATRIX.find(([re]) => re.test(tags))?.[1] ?? (Math.max(w, h) >= 1280 || Math.min(w, h) > 576 ? 'bt709' : 'bt601')
  const range = /\bpc\b/.test(tags) || /^yuvj/.test(fmt?.[1] ?? '') ? 'pc' : 'tv'
  return { matrix, range }
}

/** swscale options for converting this source's YUV to RGB. */
export const inColor = (c: ColorMeta | undefined): string =>
  `in_color_matrix=${c?.matrix ?? 'bt709'}:in_range=${c?.range ?? 'tv'}`

/** Everything exports as BT.709 limited range, converted explicitly and tagged so players agree. */
export const OUT_COLOR = 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p'
export const OUT_TAGS = ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv']
