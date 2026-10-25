<script lang="ts">
  let { value, onChange }: { value: boolean; onChange: (v: boolean) => void } = $props()
</script>

<button class={'toggle' + (value ? ' on' : '')} role="switch" aria-checked={value} aria-label="Toggle" onclick={() => onChange(!value)}></button>
