<!--
  Grid view options: what to show, how to sort it, grouping by folder, captions, and folding every
  folder at once. It stays open while things are changed; a dot on the button says a filter is
  hiding something. Right-click the button to reset.
-->
<script lang="ts">
  import type { FilterKey, SortKey, ViewPrefs } from '../../state/prefs'
  import { Button, MenuItem, MenuLabel, MenuSeparator, Popover, showMenu } from '../../ui'

  let {
    prefs,
    hasFolders,
    changed,
    onChange,
    onCollapseAll,
    onReset
  }: {
    prefs: ViewPrefs
    /** There are subfolders (so folding them means something). */
    hasFolders: boolean
    /** Anything differs from the defaults. */
    changed: boolean
    onChange: (patch: Partial<ViewPrefs>) => void
    onCollapseAll: (collapse: boolean) => void
    onReset: () => void
  } = $props()

  // In groups: what an item is, what's in it, what's been done to it.
  const FILTER_GROUPS: { value: FilterKey; label: string }[][] = [
    [{ value: 'all', label: 'All' }],
    [
      { value: 'sources', label: 'Source files' },
      { value: 'variants', label: 'Variants' },
      { value: 'compositions', label: 'Compositions' }
    ],
    [
      { value: 'images', label: 'Images' },
      { value: 'videos', label: 'Videos' }
    ],
    [
      { value: 'adjusted', label: 'Adjusted' },
      { value: 'excluded', label: 'Excluded from export' }
    ]
  ]
  const FILTERS = FILTER_GROUPS.flat()
  const SORTS: { value: SortKey; label: string }[] = [
    { value: 'name', label: 'Name' },
    { value: 'date', label: 'Date modified' },
    { value: 'type', label: 'Type' }
  ]

  let open = $state(false)
  const filter = $derived(FILTERS.find((f) => f.value === prefs.filter)!)
</script>

<div class="anchor">
  <Button
    variant="icon"
    icon="viewOptions"
    iconSize={15}
    pressed={open}
    dot={prefs.filter !== 'all'}
    title={prefs.filter !== 'all' ? `View options (showing ${filter.label.toLowerCase()})` : 'View options'}
    onclick={() => (open = !open)}
    oncontextmenu={async (e) => {
      e.preventDefault()
      const id = await showMenu(e.clientX, e.clientY, [{ id: 'reset', label: 'Reset View', icon: 'reset', enabled: changed }])
      if (id === 'reset') onReset()
    }}
  />
  <Popover {open} onClose={() => (open = false)}>
    <div class="menu">
      <MenuLabel>Show</MenuLabel>
      {#each FILTER_GROUPS as group, i (i)}
        {#if i}<div class="filter-gap"></div>{/if}
        {#each group as f (f.value)}
          <MenuItem checked={prefs.filter === f.value} onclick={() => onChange({ filter: f.value })}>{f.label}</MenuItem>
        {/each}
      {/each}
      <MenuSeparator />
      <MenuLabel>Sort by</MenuLabel>
      {#each SORTS as o (o.value)}
        <MenuItem checked={prefs.sort === o.value} onclick={() => onChange({ sort: o.value })}>{o.label}</MenuItem>
      {/each}
      <MenuSeparator />
      <MenuItem checked={prefs.group} onclick={() => onChange({ group: !prefs.group })}>Group by folder</MenuItem>
      <MenuItem checked={prefs.names} onclick={() => onChange({ names: !prefs.names })}>Show file names</MenuItem>
      {#if hasFolders && prefs.group}
        <MenuSeparator />
        <MenuItem onclick={() => onCollapseAll(true)}>Collapse all folders</MenuItem>
        <MenuItem onclick={() => onCollapseAll(false)}>Expand all folders</MenuItem>
      {/if}
      <MenuSeparator />
      <MenuItem disabled={!changed} onclick={onReset}>Reset View</MenuItem>
    </div>
  </Popover>
</div>

<style>
  /* A little space between groups of filters (a full separator would split "Show" in two). */
  .filter-gap {
    height: 6px;
  }

  .anchor {
    position: relative;
  }

  .menu {
    width: 208px;
  }
</style>
