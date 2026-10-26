<!--
  A small progress ring: filled to `value` (0..1), or with no value, a faint dashed ring (waiting
  its turn).
-->
<script lang="ts">
  let { value = null, size = 14 }: { value?: number | null; size?: number } = $props()

  const r = 5
  const c = 2 * Math.PI * r
</script>

<svg class="ring" width={size} height={size} viewBox="0 0 14 14" aria-hidden="true">
  {#if value == null}
    <circle class="waiting" cx="7" cy="7" {r} />
  {:else}
    <circle class="track" cx="7" cy="7" {r} />
    <circle class="fill" cx="7" cy="7" {r} stroke-dasharray={c} stroke-dashoffset={c * (1 - Math.min(1, Math.max(0, value)))} />
  {/if}
</svg>

<style>
  .ring {
    display: block;
    flex: none;
    transform: rotate(-90deg);
  }

  circle {
    fill: none;
    stroke-width: 2;
  }

  .track {
    stroke: currentColor;
    opacity: 0.25;
  }

  .fill {
    stroke: currentColor;
    stroke-linecap: round;
    transition: stroke-dashoffset 200ms linear;
  }

  .waiting {
    stroke: currentColor;
    stroke-dasharray: 2 2.5;
    opacity: 0.5;
  }
</style>
