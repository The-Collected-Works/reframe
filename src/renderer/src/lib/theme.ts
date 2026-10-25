const cache = new Map<string, string>()

/** A colour token from theme.css, for drawing on canvases (which can't use CSS variables). */
export function themeColor(name: `--${string}`): string {
  let c = cache.get(name)
  if (c === undefined) cache.set(name, (c = getComputedStyle(document.documentElement).getPropertyValue(name).trim()))
  return c
}
