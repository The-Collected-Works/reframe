<!-- A heading over a group in a popover menu. -->
<script lang="ts">
  import type { Snippet } from 'svelte'

  let { children }: { children: Snippet } = $props()
</script>

<div class="label">{@render children()}</div>

<style>
  .label {
    padding: 2px 10px 4px;
    font-size: 11px;
    font-weight: 600;
    color: var(--muted);
  }
</style>
