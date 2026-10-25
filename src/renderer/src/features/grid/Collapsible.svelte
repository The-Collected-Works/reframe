<!--
  A folder's body, folding open and closed by animating the row's height (0fr ↔ 1fr), with a fade.
  Closed, its contents are unmounted once the fold has finished, so a collapsed folder costs
  nothing; opening mounts them at zero height first, so the open animates from there.
-->
<script lang="ts">
  import type { Snippet } from 'svelte'

  /** How long a folder takes to open or close; matches --t-fold in styles.css. */
  const FOLD_MS = 380

  let { open, children }: { open: boolean; children: Snippet } = $props()
  // Seeded from the first value on purpose: the effect below follows it from there.
  // svelte-ignore state_referenced_locally
  let mounted = $state(open)
  // svelte-ignore state_referenced_locally
  let expanded = $state(open)
  $effect(() => {
    if (open) {
      mounted = true
      // Two frames: the closed state has to be painted before the open one can transition from it.
      let raf = requestAnimationFrame(() => (raf = requestAnimationFrame(() => (expanded = true))))
      return () => cancelAnimationFrame(raf)
    }
    expanded = false
    const t = setTimeout(() => (mounted = false), FOLD_MS + 40)
    return () => clearTimeout(t)
  })
</script>

<div class={['collapsible', { open: expanded }]}>
  <div class="collapsible-inner">{#if mounted}{@render children()}{/if}</div>
</div>
