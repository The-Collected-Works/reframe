<!-- A one-line text input. Attributes (value, events, attachments) go on the input. -->
<script lang="ts">
  import type { HTMLInputAttributes } from 'svelte/elements'

  let { ...rest }: HTMLInputAttributes = $props()
</script>

<input class="text" {...rest} />

<style>
  .text {
    height: var(--control);
    padding: 0 8px;
    border: 0;
    border-radius: 6px;
    outline: 0;
    background: var(--tint-1);
    font-weight: 500;
  }

  .text:focus {
    background: var(--tint-2);
    box-shadow: 0 0 0 1px var(--accent);
  }
</style>
