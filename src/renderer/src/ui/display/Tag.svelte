<!--
  A small label on a tint: `tag` for facts (1920×1080, 3.2 MB), `count` for a number beside a title,
  `note` for a quiet status (Exports, Excluded).
-->
<script lang="ts">
  import type { Snippet } from 'svelte'

  let { variant = 'tag', children }: { variant?: 'tag' | 'count' | 'note'; children: Snippet } = $props()
</script>

<span class={['label', variant]}>{@render children()}</span>

<style>
  .label {
    display: inline-grid;
    place-items: center;
    height: 18px;
    padding: 0 6px;
    border-radius: 5px;
    background: var(--tint-1);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .tag {
    display: inline-flex;
    align-items: center;
    height: 20px;
    color: var(--muted);
  }

  .note {
    color: var(--faint);
  }
</style>
