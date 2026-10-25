export interface Drag {
  /** Pixels the pointer must travel before it's a drag; 0 (the default): it is from the press. */
  slop?: number
  /** Once, as it becomes a drag. */
  start?: () => void
  move?: (ev: PointerEvent) => void
  /** Once, on release or cancel; `dragged`: it became a drag. */
  end?: (dragged: boolean) => void
}

/**
 * Follows a press until it's let go. The pointer is captured (by `el`, the pressed element unless
 * given) only once it's a drag, so a press that never moves stays an ordinary click on whatever was
 * pressed. Returns a function that ends it early, as a release would.
 */
export function trackPointer(e: PointerEvent, d: Drag, el = e.currentTarget as HTMLElement): () => void {
  let dragging = false
  let done = false
  const begin = () => {
    dragging = true
    el.setPointerCapture(e.pointerId)
    d.start?.()
  }
  const move = (ev: PointerEvent) => {
    if (!dragging) {
      if (Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < (d.slop ?? 0)) return
      begin()
    }
    d.move?.(ev)
  }
  const up = () => {
    if (done) return
    done = true
    el.removeEventListener('pointermove', move)
    el.removeEventListener('pointerup', up)
    el.removeEventListener('pointercancel', up)
    d.end?.(dragging)
  }
  if (!d.slop) begin()
  el.addEventListener('pointermove', move)
  el.addEventListener('pointerup', up)
  el.addEventListener('pointercancel', up)
  return up
}
