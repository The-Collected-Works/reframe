import { untrack } from 'svelte'
import { cubicOut } from 'svelte/easing'
import { Tween } from 'svelte/motion'
import { reducedMotion } from '../../lib/motion'

export type View = { k: number; bx: number; by: number }

/**
 * The view on screen: eases toward `target`, jumping when `instantKey` changes (resize, new
 * asset). While `manual` is set it shows that instead, and eases back from it once released.
 * Create it while a component initialises.
 */
export function camera(target: () => View, instantKey: () => string, manual: () => View | null): { readonly current: View } {
  const tween = new Tween(untrack(target), { duration: 240, easing: cubicOut })
  let lastKey = untrack(instantKey)
  $effect(() => {
    const m = manual()
    // Follow the manual view, so releasing it eases from where it was.
    if (m) return void tween.set(m, { duration: 0 })
    const t = target()
    const key = instantKey()
    tween.set(t, { duration: key !== lastKey || reducedMotion() ? 0 : 240 })
    lastKey = key
  })
  return {
    get current() {
      return manual() ?? tween.current
    }
  }
}
