/** Colour conversions for the picker. Hex is "#rrggbb"; h is 0–360, s and v 0–1. */

export type Hsv = { h: number; s: number; v: number }

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

const rgbToHex = (r: number, g: number, b: number): string => '#' + [r, g, b].map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')

export function toHsv(hex: string): Hsv {
  const [r, g, b] = hexToRgb(hex).map((c) => c / 255)
  const max = Math.max(r, g, b)
  const d = max - Math.min(r, g, b)
  let h = 0
  if (d) h = 60 * (max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4)
  return { h, s: max ? d / max : 0, v: max }
}

export function toHex({ h, s, v }: Hsv): string {
  const f = (n: number) => {
    const k = (n + h / 60) % 6
    return 255 * (v - v * s * Math.max(0, Math.min(k, 4 - k, 1)))
  }
  return rgbToHex(f(5), f(3), f(1))
}

/** "abc", "#aabbcc", "AABBCC" → "#aabbcc"; null if it isn't a colour. */
export function parseHex(text: string): string | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text.trim())
  if (!m) return null
  return '#' + (m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1]).toLowerCase()
}
