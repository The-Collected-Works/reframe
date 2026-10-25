import { untrack } from 'svelte'
import { reducedMotion } from '../motion'

export type View = { k: number; bx: number; by: number }

/**
 * Eases toward the target view; jumps when `instantKey` changes (resize, new asset). While `hold`
 * is set it shows that instead (a manual camera), and eases back from it once released. Create it
 * while a component initialises.
 */
export function eased(target: () => View, instantKey: () => string, hold: () => View | null): { readonly current: View } {
  let view = $state.raw(untrack(target))
  let held: View | null = null
  let lastKey = untrack(instantKey)
  $effect(() => {
    const h = hold()
    if (h) {
      held = h
      return
    }
    const { k, bx, by } = target()
    const key = instantKey()
    // Start from what was on screen (possibly the manual view) before this paint.
    const from = held ?? untrack(() => view)
    held = null
    if (lastKey !== key) {
      lastKey = key
      view = { k, bx, by }
      return
    }
    if ((from.k === k && from.bx === bx && from.by === by) || reducedMotion()) {
      view = { k, bx, by }
      return
    }
    view = from
    const t0 = performance.now()
    let raf = 0
    const step = () => {
      const t = Math.min(1, (performance.now() - t0) / 240)
      const e = 1 - Math.pow(1 - t, 3)
      view = { k: from.k + (k - from.k) * e, bx: from.bx + (bx - from.bx) * e, by: from.by + (by - from.by) * e }
      if (t < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  })
  return {
    get current() {
      return hold() ?? view
    }
  }
}
