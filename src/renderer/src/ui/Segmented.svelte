<script lang="ts" generics="T extends string">
  import Icon from './Icon.svelte'
  import type { IconName } from './icons'
  import Indicator from './Indicator.svelte'

  type Option = { value: T; label?: string; icon?: IconName; title?: string; disabled?: boolean }
  /** `compact`: tighter buttons, for icons in a toolbar. */
  let { value, options, onChange, compact = false }: { value: T; options: Option[]; onChange: (v: T) => void; compact?: boolean } = $props()
</script>

<div class={['seg', { compact }]}>
  <Indicator selector=":scope > button.on" key={`${value}/${options.length}`} />
  {#each options as o (o.value)}
    <button title={o.title} disabled={o.disabled} class={{ on: o.value === value }} onclick={() => onChange(o.value)}>
      {#if o.icon}<Icon name={o.icon} size={15} />{/if}{o.label ?? ''}
    </button>
  {/each}
</div>

<style>
  .seg {
    position: relative;
    display: flex;
    padding: 3px;
    gap: 2px;
    background: var(--tint-1);
    border-radius: 9px;
  }

  button {
    position: relative;
    z-index: 1;
    flex: 1;
    border-radius: 6px;
    display: grid;
    place-items: center;
    /* Plus the track's 3px padding = the shared control height. */
    height: calc(var(--control) - 6px);
    padding: 0 8px;
    color: var(--muted);
    white-space: nowrap;
    transition:
      color var(--t-fast) var(--ease),
      transform var(--t-fast) var(--ease);
  }

  .compact button {
    padding: 0 6px;
  }

  button:hover,
  button.on {
    color: var(--text);
  }

  button:active {
    transform: scale(0.95);
  }
</style>
