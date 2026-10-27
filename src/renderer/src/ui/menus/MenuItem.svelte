<!--
  A row in a popover menu: an optional `icon` (dimmed when `dim`), its label (the children), then on
  the right a `detail` (a size, a shortcut) or a check when `checked`. Other attributes (onclick,
  disabled, title…) go on the row.
-->
<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { HTMLButtonAttributes } from 'svelte/elements'
  import Icon from '../icons/Icon.svelte'
  import type { IconName } from '../icons/icons'

  type Props = HTMLButtonAttributes & { icon?: IconName; dim?: boolean; detail?: string; checked?: boolean; children: Snippet }
  let { icon, dim = false, detail, checked = false, children, ...rest }: Props = $props()
</script>

<button class={['menu-item', { 'has-icon': icon }]} {...rest}>
  {#if icon}<span class={['lead', { dim }]}><Icon name={icon} size={15} /></span>{/if}
  {@render children()}
  {#if detail}<span class="detail">{detail}</span>{/if}
  {#if checked}<span class="check"><Icon name="check" size={14} /></span>{/if}
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

  /* With a leading icon, the label follows it and anything on the right is pushed there. */
  .has-icon {
    justify-content: flex-start;
    gap: 10px;
  }

  .has-icon > .detail,
  .has-icon > .check {
    margin-left: auto;
  }

  .lead,
  .check {
    display: grid;
    place-items: center;
  }

  /* A toggle that's off. */
  .lead.dim :global(svg) {
    color: var(--faint);
  }

  .detail {
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }

  .menu-item :global(svg) {
    color: var(--accent);
  }
</style>
