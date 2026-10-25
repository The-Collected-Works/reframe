<!--
  Floats below the element it's declared in. Moved into document.body (a placeholder stays in place
  to find the anchor), so no ancestor's overflow, mask or transform can clip it.
-->
<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { Attachment } from 'svelte/attachments'
  import { portal } from '../../lib/attach'
  import { api } from '../../lib/bridge'
  import { closing } from '../../lib/motion'

  /** The content sizes itself; `padding` is the surface's inset around it. */
  let { open = true, onClose, children, padding = 6 }: { open?: boolean; onClose: () => void; children: Snippet; padding?: number } = $props()

  let placeholder: HTMLSpanElement
  let el = $state<HTMLDivElement>()
  const anchor = () => placeholder.parentElement!

  // Below the anchor, kept inside the window; anchored in the top bar, it opens clear of the bar's
  // edge rather than just below the anchor.
  const place: Attachment<HTMLElement> = (node) => {
    const a = anchor().getBoundingClientRect()
    const bar = placeholder.closest('.topbar')?.getBoundingClientRect()
    node.style.left = `${Math.max(8, Math.min(a.left, window.innerWidth - node.offsetWidth - 8))}px`
    node.style.top = `${Math.max(a.bottom + 8, bar ? bar.bottom + 6 : 0)}px`
    node.style.visibility = ''
  }

  // Any press outside closes it (in the capture phase, so nothing that stops propagation can keep
  // it open). Presses on the anchor are left to the anchor's own click, so it toggles rather than
  // closing here and immediately reopening.
  function onpointerdowncapture(e: PointerEvent) {
    const t = e.target as Node
    if (open && !el?.contains(t) && !anchor().contains(t)) onClose()
  }
  // Esc closes the popover and stops there (the app's own Esc would also deselect, or leave single
  // view).
  function onkeydowncapture(e: KeyboardEvent) {
    if (!open || e.key !== 'Escape') return
    e.preventDefault()
    e.stopImmediatePropagation()
    onClose()
  }
  // Clicks on the title bar's drag region never reach the page, but dragging the window closes it.
  $effect(() => {
    if (open) return api.onWindowMoving(onClose)
  })
</script>

<svelte:window {onpointerdowncapture} {onkeydowncapture} />

<span bind:this={placeholder} hidden></span>
{#if open}
  <div
    bind:this={el}
    class="popover"
    style="visibility: hidden"
    style:padding={`${padding}px`}
    {@attach portal}
    {@attach place}
    out:closing={{ duration: 120 }}
  >
    {@render children()}
  </div>
{/if}

<style>
  .popover {
    position: fixed;
    z-index: 50;
    min-width: 200px;
    background: var(--raised);
    border-radius: 10px;
    box-shadow:
      0 0 0 1px var(--line-strong),
      0 12px 40px rgba(0, 0, 0, 0.5);
    /* Over the title bar's drag region, which would otherwise take the pointer. */
    -webkit-app-region: no-drag;
    /* Grows out of its anchor. */
    transform-origin: top left;
    animation: pop-in 160ms var(--ease) both;
  }

  .popover:global(.closing) {
    animation: pop-out 120ms var(--ease) forwards;
    pointer-events: none;
  }
</style>
