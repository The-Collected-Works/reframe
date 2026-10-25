<!-- A key in a shortcut. -->
<script lang="ts">
  import type { Snippet } from 'svelte'

  let { children }: { children: Snippet } = $props()
</script>

<kbd>{@render children()}</kbd>

<style>
  kbd {
    min-width: 20px;
    height: 20px;
    padding: 0 5px;
    display: inline-grid;
    place-items: center;
    border-radius: 5px;
    background: var(--tint-2);
    color: var(--text);
    /* (A 500 11px/1 here never applied: it was invalid CSS. This is what has always shown.) */
    font-family: inherit;
  }
</style>
