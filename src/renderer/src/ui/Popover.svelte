<!--
  Floats below the element it's declared in. Moved into document.body (a placeholder stays in place
  to find the anchor), so no ancestor's overflow, mask or transform can clip it.
-->
<script lang="ts">
  import type { Snippet } from 'svelte'
  import { api } from '../media'
  import { presence } from '../presence.svelte'
  import { portal } from './portal'

  let { open = true, onClose, children, class: className = '' }: { open?: boolean; onClose: () => void; children: Snippet; class?: string } = $props()

  let el = $state<HTMLDivElement>()
  let placeholder: HTMLSpanElement
  let pos = $state<{ left: number; top: number } | null>(null)
  const shown = presence(() => open, 120)

  $effect.pre(() => {
    if (!shown.mounted) pos = null
  })
  $effect(() => {
    if (!shown.mounted || !el) return
    const anchor = placeholder.parentElement!.getBoundingClientRect()
    const left = Math.max(8, Math.min(anchor.left, window.innerWidth - el.offsetWidth - 8))
    // Anchored in the top bar: open clear of the bar's edge, not just below the anchor.
    const bar = placeholder.closest('.topbar')?.getBoundingClientRect()
    pos = { left, top: Math.max(anchor.bottom + 8, bar ? bar.bottom + 6 : 0) }
  })

  // Registered while open, in the capture phase (so nothing that stops propagation can keep it
  // open), ignoring the press that opened it. Presses on the anchor are left to the anchor's own
  // click, so it toggles rather than closing here and immediately reopening.
  $effect(() => {
    if (!open) return
    const opened = performance.now()
    const down = (e: PointerEvent) => {
      const t = e.target as Node
      const anchor = placeholder?.parentElement
      if (e.timeStamp < opened || el?.contains(t) || anchor?.contains(t)) return
      onClose()
    }
    // Esc closes the popover and stops there (the app's own Esc would also deselect, or leave
    // single view).
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopImmediatePropagation()
      onClose()
    }
    window.addEventListener('pointerdown', down, true)
    window.addEventListener('keydown', key, true)
    // Clicks on the title bar's drag region never reach the page, but dragging the window closes it.
    const offMove = api.onWindowMoving(() => onClose())
    return () => {
      window.removeEventListener('pointerdown', down, true)
      window.removeEventListener('keydown', key, true)
      offMove()
    }
  })
</script>

<span bind:this={placeholder} hidden></span>
{#if shown.mounted}
  <div
    bind:this={el}
    use:portal
    class={'popover ' + className + (shown.closing ? ' closing' : '')}
    style={pos ? `left: ${pos.left}px; top: ${pos.top}px` : 'visibility: hidden'}
  >
    {@render children()}
  </div>
{/if}
