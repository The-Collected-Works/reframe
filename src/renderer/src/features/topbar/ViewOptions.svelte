<!--
  Grid view options: what to show, how to sort it, grouping by folder, captions, and folding every
  folder at once. It stays open while things are changed; a dot on the button says something's
  hidden. Right-click the button to reset.

  What shows: every value of every facet (see FACETS), with an eye, open while it shows. Clicking one hides
  or shows it; Only (or Alt-click) shows just it within its facet, and again shows all of them. The
  counts are what each would show, given the rest.
-->
<script lang="ts">
  import { FACETS, VALUES, valueId, type Facet } from '../../config/filters'
  import type { SortKey, ViewPrefs } from '../../state/prefs'
  import { Button, Icon, MenuItem, MenuLabel, MenuSeparator, Popover, showMenu } from '../../ui'

  let {
    prefs,
    counts,
    hasFolders,
    changed,
    onChange,
    onCollapseAll,
    onReset
  }: {
    prefs: ViewPrefs
    /** How many items have each value (by id), given the rest: read only while open. */
    counts: () => Map<string, number>
    /** There are subfolders (so folding them means something). */
    hasFolders: boolean
    /** Anything differs from the defaults. */
    changed: boolean
    onChange: (patch: Partial<ViewPrefs>) => void
    onCollapseAll: (collapse: boolean) => void
    onReset: () => void
  } = $props()

  const hidden = $derived(new Set(prefs.hidden))
  const toggle = (id: string) => onChange({ hidden: hidden.has(id) ? prefs.hidden.filter((x) => x !== id) : [...prefs.hidden, id] })
  const idsOf = (f: Facet) => f.values.map((v) => valueId(f.key, v.key))
  /** Showing just `id` in its facet. */
  const alone = (f: Facet, id: string) => idsOf(f).every((x) => (x === id) !== hidden.has(x))
  // Just this one; just this one already: all of them again.
  const only = (f: Facet, id: string) => {
    const others = idsOf(f).filter((x) => x !== id)
    const rest = prefs.hidden.filter((x) => !idsOf(f).includes(x))
    onChange({ hidden: alone(f, id) ? rest : [...rest, ...others] })
  }

  const SORTS: { value: SortKey; label: string }[] = [
    { value: 'name', label: 'Name' },
    { value: 'date', label: 'Date modified' },
    { value: 'type', label: 'Type' }
  ]
  // Adjustments are the current artboard's (they follow the tab).
  const SECTIONS: { label: string; facets: Facet[] }[] = [
    { label: 'Item', facets: FACETS.filter((f) => f.key === 'item') },
    { label: 'Media', facets: FACETS.filter((f) => f.key === 'media') },
    { label: 'Adjustments', facets: FACETS.filter((f) => f.board) }
  ]

  let open = $state(false)
  // Counted only while it's open: counting looks at every item's edits on the artboard.
  const counted = $derived(open ? counts() : new Map<string, number>())
  const hiding = $derived(
    VALUES.filter((v) => hidden.has(v.id))
      .map((v) => v.label.toLowerCase())
      .join(', ')
  )
</script>

<div class="anchor">
  <Button
    variant="icon"
    icon="viewOptions"
    iconSize={15}
    pressed={open}
    dot={prefs.hidden.length > 0}
    title={hiding ? `View options (hiding ${hiding})` : 'View options'}
    onclick={() => (open = !open)}
    oncontextmenu={async (e) => {
      e.preventDefault()
      const id = await showMenu(e.clientX, e.clientY, [{ id: 'reset', label: 'Reset View', icon: 'reset', enabled: changed }])
      if (id === 'reset') onReset()
    }}
  />
  <Popover {open} onClose={() => (open = false)}>
    <div class="menu">
      {#each SECTIONS as section, i (section.label)}
        {#if i > 0}<div class="section-gap"></div>{/if}
        <div class="section-head">
          <MenuLabel>{section.label}</MenuLabel>
          {#if i === 0 && prefs.hidden.length}<button class="show-all" onclick={() => onChange({ hidden: [] })}>Show all</button>{/if}
        </div>
        {#each section.facets as facet, j (facet.key)}
          {#if j > 0}<div class="facet-gap"></div>{/if}
          {#each facet.values as v (v.key)}
            {@const id = valueId(facet.key, v.key)}
            {@const off = hidden.has(id)}
            <div class={['value', { off }]}>
              <button class="toggle" title={v.title} onclick={(e) => (e.altKey ? only(facet, id) : toggle(id))}>
                <Icon name={off ? 'exclude' : 'show'} size={14} />
                <span class="name">{v.label}</span>
                <span class="count">{counted.get(id) ?? 0}</span>
              </button>
              <button class="only" title="Show just this (Alt-click)" onclick={() => only(facet, id)}>{alone(facet, id) ? 'All' : 'Only'}</button>
            </div>
          {/each}
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
  .anchor {
    position: relative;
  }

  .menu {
    width: 232px;
  }

  .section-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
  }

  .section-gap {
    height: 8px;
  }

  .show-all {
    padding: 2px 10px;
    font-size: 11px;
    color: var(--accent);
  }

  .show-all:hover {
    text-decoration: underline;
  }

  /* Between the facets in one section (framing, then export). */
  .facet-gap {
    height: 4px;
  }

  .value {
    position: relative;
    border-radius: 6px;
    transition: background-color var(--t-fast) var(--ease);
  }

  .value:hover {
    background: var(--hover);
  }

  .toggle {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    height: 30px;
    padding: 0 10px;
    text-align: left;
  }

  .toggle :global(svg) {
    color: var(--accent);
    flex-shrink: 0;
  }

  .name {
    flex: 1;
    white-space: nowrap;
    transition: color var(--t-fast) var(--ease);
  }

  .count {
    color: var(--muted);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    transition: opacity var(--t-fast) var(--ease);
  }

  /* Only takes the count's place. */
  .value:hover .count,
  .value:has(.only:focus-visible) .count {
    opacity: 0;
  }

  .off .toggle :global(svg),
  .off .name,
  .off .count {
    color: var(--faint);
  }

  /* Over the count, on hover. */
  .only {
    position: absolute;
    right: 4px;
    top: 50%;
    translate: 0 -50%;
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 11px;
    color: var(--muted);
    background: var(--raised);
    opacity: 0;
    transition: opacity var(--t-fast) var(--ease);
  }

  .value:hover .only,
  .only:focus-visible {
    opacity: 1;
  }

  .only:hover {
    color: var(--text);
    background: color-mix(in srgb, var(--raised), white 10%);
  }
</style>
