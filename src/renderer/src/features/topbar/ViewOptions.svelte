<!--
  Grid view options: what to show, how to sort it, grouping by folder, captions, and folding every
  folder at once. It stays open while things are changed; a dot on the button says a filter is
  hiding something.
-->
<script lang="ts">
  import { app } from '../../state/app.svelte'
  import { type FilterKey, type SortKey, VIEW_DEFAULTS, type ViewPrefs } from '../../state/prefs'
  import Icon from '../../ui/Icon.svelte'
  import { showMenu } from '../../ui/menu.svelte'
  import Popover from '../../ui/Popover.svelte'

  const FILTERS: { value: FilterKey; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'images', label: 'Images' },
    { value: 'videos', label: 'Videos' },
    { value: 'adjusted', label: 'Adjusted' },
    { value: 'excluded', label: 'Excluded from export' }
  ]
  const SORTS: { value: SortKey; label: string }[] = [
    { value: 'name', label: 'Name' },
    { value: 'date', label: 'Date modified' },
    { value: 'type', label: 'Type' }
  ]

  let open = $state(false)
  const prefs = $derived(app.viewPrefs)
  const hasFolders = $derived(app.assets.some((a) => a.name.includes('/')))
  const changed = $derived(app.collapsed.length > 0 || (Object.keys(VIEW_DEFAULTS) as (keyof ViewPrefs)[]).some((k) => prefs[k] !== VIEW_DEFAULTS[k]))
  const filter = $derived(FILTERS.find((f) => f.value === prefs.filter)!)
</script>

{#snippet option(on: boolean, label: string, onclick: () => void)}
  <button class="menu-item" {onclick}>
    <span>{label}</span>
    {#if on}<Icon name="check" size={14} />{/if}
  </button>
{/snippet}

<div class="anchor">
  <button
    class={['icon-btn view-btn', { on: open, filtered: prefs.filter !== 'all' }]}
    title={prefs.filter !== 'all' ? `View options (showing ${filter.label.toLowerCase()})` : 'View options'}
    onclick={() => (open = !open)}
    oncontextmenu={async (e) => {
      e.preventDefault()
      const id = await showMenu(e.clientX, e.clientY, [{ id: 'reset', label: 'Reset View', icon: 'reset', enabled: changed }])
      if (id === 'reset') app.resetView()
    }}
  >
    <Icon name="viewOptions" size={15} />
  </button>
  <Popover {open} onClose={() => (open = false)}>
    <div class="menu">
      <div class="menu-label">Show</div>
      {#each FILTERS as f (f.value)}{@render option(prefs.filter === f.value, f.label, () => app.setViewPrefs({ filter: f.value }))}{/each}
      <div class="menu-sep"></div>
      <div class="menu-label">Sort by</div>
      {#each SORTS as o (o.value)}{@render option(prefs.sort === o.value, o.label, () => app.setViewPrefs({ sort: o.value }))}{/each}
      <div class="menu-sep"></div>
      {@render option(prefs.group, 'Group by folder', () => app.setViewPrefs({ group: !prefs.group }))}
      {@render option(prefs.names, 'Show file names', () => app.setViewPrefs({ names: !prefs.names }))}
      {#if hasFolders && prefs.group}
        <div class="menu-sep"></div>
        {@render option(false, 'Collapse all folders', () => app.setAllCollapsed(true))}
        {@render option(false, 'Expand all folders', () => app.setAllCollapsed(false))}
      {/if}
      <div class="menu-sep"></div>
      <button class="menu-item" disabled={!changed} onclick={() => app.resetView()}>
        <span>Reset View</span>
      </button>
    </div>
  </Popover>
</div>

<style>
  .anchor {
    position: relative;
  }

  .icon-btn {
    position: relative;
  }

  /* A dot on the button while a filter is hiding something. */
  .filtered::after {
    content: '';
    position: absolute;
    top: 6px;
    right: 6px;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent);
  }

  .menu {
    width: 208px;
  }

  .menu :global(svg) {
    color: var(--accent);
  }
</style>
