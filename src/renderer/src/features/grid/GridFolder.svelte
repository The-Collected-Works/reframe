<!--
  A folder: its header, then a body holding its own thumbnails and its subfolders. Collapsing folds
  the body, so everything inside goes with it. Hovering the header tints the folder's own box (a
  rounded card), which contains its subfolders, so the tint covers exactly what a click would fold.
-->
<script lang="ts">
  import { app } from '../../state/app.svelte'
  import { type FolderNode } from '../../state/library'
  import Icon from '../../ui/Icon.svelte'
  import { excludedFolderMenu, folderMenu } from '../menus'
  import Collapsible from './Collapsible.svelte'
  import GridFolder from './GridFolder.svelte'
  import { GAP, PAD, type GridLayout } from './shared'
  import Thumbnail from './Thumbnail.svelte'

  let { node, g }: { node: FolderNode; g: GridLayout } = $props()
  const excluded = $derived(node.excluded)
</script>

<!-- Folder icon and the full path from a leading slash, parents muted: "/" for the top level, "/ Shoot A / Day 2". -->
{#snippet folderName(folder: string)}
  {@const crumbs = folder ? folder.split('/') : ['/']}
  <span class="section-icon" aria-hidden="true"><Icon name="folder" size={13} /></span>
  <span class="section-path">
    <!-- Nested folders keep the top level's leading slash, so every path reads from "/". -->
    {#if folder}<span class="section-sep" aria-hidden="true">/</span>{/if}{#each crumbs as c, i (i)}{#if i > 0}<span class="section-sep" aria-hidden="true">/</span>{/if}<span
        class={['section-crumb', { current: i === crumbs.length - 1 }]}>{c}</span
      >{/each}
  </span>
{/snippet}

{#snippet grid()}
  {#if node.assets.length > 0}
    <div class="grid" style:grid-template-columns={`repeat(${g.cols}, ${g.cellW}px)`} style:gap={`${GAP}px`}>
      {#each node.assets as a (a.name)}
        <Thumbnail entry={a} board={g.board} width={g.cellW - PAD * 2} active={g.active} names={g.names} withFolder={g.withFolder} />
      {/each}
    </div>
  {/if}
{/snippet}

{#if !g.headers}
  <div class="grid-folder">{@render grid()}</div>
{:else if excluded}
  <!--
    An excluded folder (or Reframe's exports), dimmed in its place among the folders, with a tag
    saying why. It tints on hover like any folder, but a click does nothing (clicking a bar is how
    other folders collapse, so a click here shouldn't quietly bring it back): including it again
    is in its right-click menu.
  -->
  <div class="grid-folder excluded" data-folder={node.folder}>
    <div
      class="grid-section excluded"
      role="presentation"
      title={`${excluded.reason === 'export' ? 'Reframe’s exports, left out of the project' : 'Excluded from the project'}. Right-click to include it`}
      onpointerdown={(e) => e.stopPropagation()}
      oncontextmenu={(e) => {
        e.preventDefault()
        excludedFolderMenu(excluded.path, { x: e.clientX, y: e.clientY })
      }}
    >
      {@render folderName(excluded.path)}
      <span class="excluded-tag">{excluded.reason === 'export' ? 'Exports' : 'Excluded'}</span>
    </div>
  </div>
{:else}
  <div class={['grid-folder', { collapsed: node.collapsed }]} data-folder={node.folder}>
    <!--
      The folder's header. It sticks to the top while its folder scrolls by; a subfolder's header
      slides over it there while the subfolder passes, so one bar always says where you are. The
      whole bar is the control (click to fold the folder away): folder icon and full path, then the
      count of everything inside and the collapse chevron, pointing in toward the path while
      collapsed.
    -->
    <button
      class={['grid-section', { collapsed: node.collapsed }]}
      title={`${node.folder ? `${g.rootName}/${node.folder}` : g.rootName}. Click to ${node.collapsed ? 'expand' : 'collapse'}`}
      aria-expanded={!node.collapsed}
      onpointerdown={(e) => e.stopPropagation()}
      onclick={() => app.toggleCollapsed(node.folder)}
      oncontextmenu={(e) => {
        e.preventDefault()
        folderMenu(node.folder, { x: e.clientX, y: e.clientY })
      }}
    >
      {@render folderName(node.folder)}
      <span class="section-count">{node.count}</span>
      <span class="section-chevron" aria-hidden="true"><Icon name="chevronDown" size={14} /></span>
    </button>
    <Collapsible open={!node.collapsed}>
      <div class="folder-body">
        {@render grid()}
        {#each node.children as c (c.folder)}
          <GridFolder node={c} {g} />
        {/each}
      </div>
    </Collapsible>
  </div>
{/if}

<style>
  /* Folders, nested as they are on disk: a folder's box holds its header, its thumbnails and its
     subfolders. Each box reaches 10px out past its parent's content (and pads back in), so every
     folder spans the same width, 16px from either side of the window (clear of the scrollbar), and
     hovering a header tints its folder's box as a rounded card that covers its subfolders too. */
  .grid-folder {
    margin: 0 -10px;
    padding: 0 10px;
    border-radius: 12px;
    transition: background-color 220ms var(--ease);
  }

  /* Between folders, and between a folder's thumbnails and its first subfolder. (Global: the
     neighbours are other instances of this component, which Svelte can't see from here.) */
  :global(.grid-folder + .grid-folder),
  .grid + :global(.grid-folder) {
    margin-top: 18px;
  }

  .grid-folder:has(> .grid-section:hover) {
    background-color: var(--card);
  }

  .grid {
    display: grid;
    align-items: end;
  }

  /* A folder's body: the gap under its header and room under its last row. It folds away with the
     folder, so a collapsed folder is just its header. A block formatting context, so children's
     margins can't escape the fold's clip. */
  .folder-body {
    display: flow-root;
    padding: 8px 0 10px;
  }

  /* Ending in a subfolder, whose box already has that room and spans the same width, a folder ends
     with it (as its sides do), rather than stacking another gap under it at each level. */
  .folder-body:has(> :global(.grid-folder:last-child)) {
    padding-bottom: 0;
  }

  /* Headers span their folder's card, edge to edge; the text lines up with the thumbnails. They
     stick while their folder scrolls by, a subfolder's sliding over its parent's, so the top bar
     always shows the full path to where you are. In place, a header is see-through and its folder's
     card (tint and all) is the only surface; only while stuck does it get a surface of its own. */
  .grid-section {
    position: sticky;
    /* Flush with the top: sticky offsets start inside the scroller's top padding. */
    top: -16px;
    z-index: 2;
    container-type: scroll-state;
    display: flex;
    align-items: center;
    gap: 10px;
    width: calc(100% + 20px);
    /* About 20px above and below the icons, as at the sides. */
    height: 54px;
    margin: 0 -10px;
    padding: 0 20px;
    border-radius: 12px;
    color: var(--muted);
    font-weight: 500;
    text-align: left;
  }

  /* The stuck surface: the colour of what's behind the header in place (the window, or the card
     while the folder is hovered), slightly see-through and lightly blurred so thumbnails scrolling
     under it show faintly. Over its own colour it adds nothing, so it looks just like the header in
     place (88% also rounds cleanly there, where some opacities land a shade off). Square on top, as
     the card's top has scrolled away and it runs on off the edge; rounded below like the card, for
     when the folder's end pushes it off. */
  .grid-section::before {
    content: '';
    position: absolute;
    inset: 0;
    z-index: -1;
    border-radius: 0 0 12px 12px;
    background-color: color-mix(in srgb, var(--well) 88%, transparent);
    backdrop-filter: blur(6px);
    pointer-events: none;
    visibility: hidden;
    transition: background-color 220ms var(--ease);
  }

  @container scroll-state(stuck: top) {
    .grid-section::before {
      visibility: visible;
    }
  }

  .grid-folder:has(> .grid-section:not(.excluded):hover) .grid-section:not(.excluded)::before {
    background-color: color-mix(in srgb, var(--card) 88%, transparent);
  }

  :global(.keyboard-nav) .grid-section:focus-visible {
    outline: 1.5px solid var(--accent);
    outline-offset: -2px;
  }

  .section-icon {
    display: grid;
    place-items: center;
    margin-right: -2px;
  }

  .section-path {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    overflow: hidden;
    white-space: nowrap;
  }

  .section-crumb {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .section-crumb.current {
    color: var(--text);
  }

  .section-sep {
    color: var(--faint);
  }

  .section-count {
    height: 18px;
    padding: 0 6px;
    display: inline-grid;
    place-items: center;
    border-radius: 5px;
    background: var(--tint-1);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  }

  .section-chevron {
    display: grid;
    place-items: center;
    transition: transform 200ms var(--ease), color var(--t-fast) var(--ease);
  }

  .grid-section.collapsed .section-chevron {
    transform: rotate(90deg);
  }

  .grid-section:hover .section-chevron {
    color: var(--text);
  }

  /* An excluded folder in its place: a quiet, inert bar (not sticky, no background of its own) with
     a tag saying why. Including it again is in its right-click menu. */
  .grid-section.excluded {
    position: relative;
    top: auto;
    z-index: auto;
  }

  .excluded .section-icon,
  .excluded .section-path {
    opacity: 0.45;
  }

  .excluded-tag {
    height: 18px;
    padding: 0 6px;
    display: inline-grid;
    place-items: center;
    border-radius: 5px;
    background: var(--tint-1);
    color: var(--faint);
    font-size: 11px;
  }
</style>
