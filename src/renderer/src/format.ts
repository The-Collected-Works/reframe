export const fmtTime = (t: number): string => {
  const m = Math.floor(t / 60)
  const s = t - m * 60
  return `${m}:${s.toFixed(1).padStart(4, '0')}`
}

/**
 * Middle-click resets a value field. Handled on press so the browser's autoscroll (and, on Linux,
 * primary-selection paste) never starts. Spread onto the element.
 */
export function middleReset(onReset?: () => void): Record<string, (e: MouseEvent) => void> {
  if (!onReset) return {}
  return {
    onmousedown: (e) => {
      if (e.button !== 1) return
      e.preventDefault()
      onReset()
    },
    onauxclick: (e) => {
      if (e.button === 1) e.preventDefault()
    }
  }
}
