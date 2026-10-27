<!--
  Grid view options: what to show, how to sort it, grouping by folder, captions, and folding every
  folder at once. It stays open while things are changed; a dot on the button says a filter is
  hiding something. Right-click the button to reset.
-->
<script lang="ts">
  import { FILTER_GROUPS, type FilterKey, type SortKey, type ViewPrefs } from '../../state/prefs'
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

  const LABELS: Record<FilterKey, string> = {
    sources: 'Source files',
    variants: 'Variants',
    compositions: 'Compositions',
    images: 'Images',
    videos: 'Videos',
    adjusted: 'Adjusted',
    excluded: 'Excluded from export'
  }
  // Showing everything (All): every eye open, greyed. Otherwise on is lit, off is greyed and shut.
  const eye = (f: FilterKey) =>
    !prefs.filters.length
      ? { icon: 'show' as const, dim: true }
      : prefs.filters.includes(f)
        ? { icon: 'show' as const }
        : { icon: 'exclude' as const, dim: true }
  // Each toggles; All clears them.
  const toggle = (f: FilterKey) => onChange({ filters: prefs.filters.includes(f) ? prefs.filters.filter((x) => x !== f) : [...prefs.filters, f] })
  const SORTS: { value: SortKey; label: string }[] = [
    { value: 'name', label: 'Name' },
    { value: 'date', label: 'Date modified' },
    { value: 'type', label: 'Type' }
  ]

  let open = $state(false)
  const showing = $derived(prefs.filters.map((f) => LABELS[f].toLowerCase()).join(', '))
</script>

<div class="anchor">
  <Button
    variant="icon"
    icon="viewOptions"
    iconSize={15}
    pressed={open}
    dot={prefs.filters.length > 0}
    title={showing ? `View options (showing ${showing})` : 'View options'}
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
      <MenuItem indicator={prefs.filters.length ? { icon: 'exclude', dim: true } : { icon: 'show' }} onclick={() => onChange({ filters: [] })}>All</MenuItem>
      {#each FILTER_GROUPS as group, i (i)}
        <div class="filter-gap"></div>
        {#each group as f (f)}
          <MenuItem indicator={eye(f)} onclick={() => toggle(f)}>{LABELS[f]}</MenuItem>
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
  /* A little space between groups of filters (a separator would split "Show" in two). */
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
