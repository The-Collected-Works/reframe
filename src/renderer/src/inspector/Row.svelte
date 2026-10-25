<script lang="ts">
  import type { Snippet } from 'svelte'

  let {
    label,
    overridden,
    onReset,
    onMakeDefault,
    children
  }: { label: string; overridden: boolean; onReset: () => void; onMakeDefault: () => void; children: Snippet } = $props()
</script>

<div class="row">
  <div class="row-label">
    {label}
    {#if overridden}
      <button class="dot" title="Reset to default" aria-label="Reset to default" onclick={onReset}></button>
      <!-- Revealed on hover: promote this value to the artboard's default. -->
      <button class="row-action" title="Use this value as the default for every asset" onclick={onMakeDefault}>Make default</button>
    {/if}
  </div>
  <div class="row-body">{@render children()}</div>
</div>
