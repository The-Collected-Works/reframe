<script lang="ts">
  /** `mixed`: some of what it stands for is on and some off; turning it on turns all on. */
  let { value, mixed = false, onChange }: { value: boolean; mixed?: boolean; onChange: (v: boolean) => void } = $props()
</script>

<button
  class={['toggle', { on: value && !mixed, mixed }]}
  role="switch"
  aria-checked={mixed ? 'mixed' : value}
  aria-label="Toggle"
  onclick={() => onChange(mixed || !value)}
></button>
