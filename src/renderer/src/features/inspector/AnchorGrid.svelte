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
