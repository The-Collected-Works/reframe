<!--
  A small glass toolbar floating over the stage, centred above a rectangle (the selected cell or
  group), or inside its top when there's no room above. Takes the rectangle in stage pixels.
-->
<script lang="ts">
  import type { Snippet } from 'svelte'

  let { at, stageWidth, children }: { at: { x: number; y: number; w: number; h: number }; stageWidth: number; children: Snippet } = $props()

  let width = $state(0)
  const ABOVE = 44
  const left = $derived(Math.max(8, Math.min(stageWidth - width - 8, at.x + at.w / 2 - width / 2)))
  const top = $derived(at.y - ABOVE >= 8 ? at.y - ABOVE : at.y + 8)
</script>

<div
  class="bar"
  role="toolbar"
  tabindex="-1"
  bind:clientWidth={width}
  style:left={`${left}px`}
  style:top={`${top}px`}
  onpointerdown={(e) => e.stopPropagation()}
>
  {@render children()}
</div>

<style>
  .bar {
    position: absolute;
    z-index: 4;
    display: flex;
    align-items: center;
    gap: 2px;
    height: 36px;
    padding: 0 4px;
    border-radius: 10px;
    background: var(--glass-bg);
    backdrop-filter: var(--glass-filter);
    box-shadow: var(--glass-shadow);
    white-space: nowrap;
    animation: pop-in 140ms var(--ease) both;
  }

  .bar :global(.label) {
    padding: 0 8px 0 6px;
    color: var(--muted);
    font-size: 11px;
    font-weight: 500;
  }

  .bar :global(.sep) {
    width: 1px;
    height: 18px;
    margin: 0 3px;
    background: var(--line-strong);
  }
</style>
