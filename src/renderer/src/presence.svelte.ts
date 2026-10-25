import { reducedMotion } from './motion'

/**
 * Keeps something mounted for `ms` after `open()` goes false, so it can animate out. `closing` is
 * true during that window. Create it while a component initialises.
 */
export function presence(open: () => boolean, ms = 140): { readonly mounted: boolean; readonly closing: boolean } {
  let mounted = $state(open())
  $effect(() => {
    if (open()) {
      mounted = true
      return
    }
    const t = setTimeout(() => (mounted = false), reducedMotion() ? 0 : ms)
    return () => clearTimeout(t)
  })
  return {
    get mounted() {
      return open() || mounted
    },
    get closing() {
      return !open() && mounted
    }
  }
}
