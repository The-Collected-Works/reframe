<script lang="ts">
  let { value, onChange }: { value: boolean; onChange: (v: boolean) => void } = $props()
</script>

<button class={['toggle', { on: value }]} role="switch" aria-checked={value} aria-label="Toggle" onclick={() => onChange(!value)}></button>
