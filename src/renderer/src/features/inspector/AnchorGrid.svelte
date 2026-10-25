<script lang="ts">
  let { x, y, onChange }: { x: number; y: number; onChange: (x: number, y: number) => void } = $props()
  const cells = [0, 0.5, 1].flatMap((ay) => [0, 0.5, 1].map((ax) => [ax, ay] as const))
</script>

<div class="anchor">
  {#each cells as [ax, ay] (`${ax}${ay}`)}
    <button
      class={{ on: Math.abs(ax - x) < 0.01 && Math.abs(ay - y) < 0.01 }}
      aria-label={`Anchor ${ax}, ${ay}`}
      onclick={() => onChange(ax, ay)}><span></span></button
    >
  {/each}
</div>

<style>
  /* 3 × 20 + 2 × 3 gaps + 2 × 3 padding = 72: exactly the height of the X/Y pair beside it. */
  .anchor {
    flex: none;
    display: grid;
    grid-template-columns: repeat(3, 20px);
    grid-template-rows: repeat(3, 20px);
    padding: 3px;
    gap: 3px;
    background: var(--tint-1);
    border-radius: 8px;
  }

  button {
    display: grid;
    place-items: center;
    border-radius: 4px;
    transition: background-color var(--t-fast) var(--ease), color var(--t-fast) var(--ease), transform var(--t-fast) var(--ease);
  }

  button:active {
    transform: scale(0.95);
  }

  span {
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: var(--faint);
  }

  button:hover span {
    background: var(--text);
  }

  .on {
    background: var(--raised);
  }

  .on span {
    width: 6px;
    height: 6px;
    background: var(--accent);
  }
</style>
