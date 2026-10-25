/** Shared motion helpers. Everything here is skipped when the OS asks for reduced motion. */

const EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)'

export const reducedMotion = (): boolean => matchMedia('(prefers-reduced-motion: reduce)').matches

/** A copy of a canvas region, or of the whole canvas. */
export function snapshot(src: HTMLCanvasElement, sx = 0, sy = 0, sw = src.width, sh = src.height): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(sw))
  c.height = Math.max(1, Math.round(sh))
  c.getContext('2d')!.drawImage(src, sx, sy, sw, sh, 0, 0, c.width, c.height)
  return c
}

/**
 * Flies `image` from one on-screen rect to another, positioned inside `host`. Resolves once it
 * has landed; the caller reveals the real content, then calls the returned `dismiss` to fade
 * the flyer out on top of it, so the hand-off is invisible.
 */
export async function fly(
  host: HTMLElement,
  image: HTMLCanvasElement,
  from: DOMRect,
  to: DOMRect,
  duration = 320
): Promise<() => void> {
  const h = host.getBoundingClientRect()
  image.className = 'flyer'
  Object.assign(image.style, {
    left: `${to.left - h.left}px`,
    top: `${to.top - h.top}px`,
    width: `${to.width}px`,
    height: `${to.height}px`
  })
  host.appendChild(image)
  const dismiss = () => {
    const out = image.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 140, easing: 'ease-out' })
    out.finished.finally(() => image.remove())
  }
  if (reducedMotion()) return dismiss
  const dx = from.left - to.left
  const dy = from.top - to.top
  const anim = image.animate(
    [
      { transform: `translate(${dx}px, ${dy}px) scale(${from.width / to.width}, ${from.height / to.height})`, borderRadius: '3px' },
      { transform: 'none', borderRadius: '0px' }
    ],
    { duration, easing: EASE }
  )
  await anim.finished.catch(() => {})
  return dismiss
}

/**
 * Where `el` will be once `container`, mid-way through a centred scale transition, settles at
 * scale 1. Scaling about the centre leaves the centre fixed, so dividing out the current scale
 * around it gives the final rect.
 */
export function settledRect(el: Element, container: HTMLElement): DOMRect {
  const g = container.getBoundingClientRect()
  const s = container.offsetWidth ? g.width / container.offsetWidth : 1
  const cx = g.left + g.width / 2
  const cy = g.top + g.height / 2
  const r = el.getBoundingClientRect()
  return new DOMRect(cx + (r.left - cx) / s, cy + (r.top - cy) / s, r.width / s, r.height / s)
}

/** Lays a still of `canvas` over itself and fades it away, so whatever is drawn next crossfades in. */
export function crossfade(canvas: HTMLCanvasElement, duration = 180): void {
  if (reducedMotion() || !canvas.width || !canvas.parentElement) return
  const still = snapshot(canvas)
  still.className = 'crossfade'
  Object.assign(still.style, { width: canvas.style.width, height: canvas.style.height })
  canvas.parentElement.insertBefore(still, canvas.nextSibling)
  still.animate([{ opacity: 1 }, { opacity: 0 }], { duration, easing: 'ease-out' }).finished.finally(() => still.remove())
}
