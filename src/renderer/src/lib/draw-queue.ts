// Thumbnails (grid cells, filmstrip) draw lazily: only when on (or near) screen, only when their
// content changed, and through a per-frame time budget so a large redraw never blocks input.
const drawQueue = new Set<() => void>()
let drawRaf = 0

export function scheduleDraw(task: () => void) {
  drawQueue.add(task)
  if (!drawRaf) drawRaf = requestAnimationFrame(flushDraws)
}

function flushDraws() {
  drawRaf = 0
  const t0 = performance.now()
  for (const task of drawQueue) {
    drawQueue.delete(task)
    task()
    if (performance.now() - t0 > 6) break
  }
  if (drawQueue.size) drawRaf = requestAnimationFrame(flushDraws)
}

let observer: IntersectionObserver | null = null
const onVisibility = new WeakMap<Element, (visible: boolean) => void>()

export function observeVisibility(el: Element, cb: (visible: boolean) => void): () => void {
  observer ??= new IntersectionObserver((entries) => entries.forEach((e) => onVisibility.get(e.target)?.(e.isIntersecting)), { rootMargin: '400px 0px' })
  onVisibility.set(el, cb)
  observer.observe(el)
  return () => {
    observer?.unobserve(el)
    onVisibility.delete(el)
  }
}
