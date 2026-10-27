<!--
  A row in a popover menu: its label (the children), then on the right a `detail` (a size, a
  shortcut) or, when `checked`, a check (or another `mark`: an eye for a filter that's showing).
  Other attributes (onclick, disabled, title…) go on the row.
-->
<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { HTMLButtonAttributes } from 'svelte/elements'
  import Icon from '../icons/Icon.svelte'
  import type { IconName } from '../icons/icons'

  type Props = HTMLButtonAttributes & { detail?: string; checked?: boolean; mark?: IconName; children: Snippet }
  let { detail, checked = false, mark = 'check', children, ...rest }: Props = $props()
</script>

<button class="menu-item" {...rest}>
  {@render children()}
  {#if detail}<span class="detail">{detail}</span>{/if}
  {#if checked}<Icon name={mark} size={14} />{/if}
</button>

<style>
  .menu-item {
    display: flex;
    align-items: center;
    width: 100%;
    justify-content: space-between;
    gap: 24px;
    height: var(--control);
    padding: 0 10px;
    border-radius: 6px;
    white-space: nowrap;
    transition:
      background-color var(--t-fast) var(--ease),
      color var(--t-fast) var(--ease),
      transform var(--t-fast) var(--ease),
      opacity var(--t-fast) var(--ease);
  }

  .menu-item:hover {
    background: var(--hover);
  }

  .detail {
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }

  .menu-item :global(svg) {
    color: var(--accent);
  }
</style>
