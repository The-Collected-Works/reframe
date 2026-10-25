<!--
  A folder: its header, then a body holding its own thumbnails and its subfolders. Collapsing folds
  the body, so everything inside goes with it. Hovering the header tints the folder's own box (a
  rounded card), which contains its subfolders, so the tint covers exactly what a click would fold.
-->
<script lang="ts">
  import { excludedFolderMenu, folderMenu } from '../menus'
  import { app, type FolderNode } from '../store.svelte'
  import Icon from '../ui/Icon.svelte'
  import Cell from './Cell.svelte'
  import Collapsible from './Collapsible.svelte'
  import FolderName from './FolderName.svelte'
  import GridFolder from './GridFolder.svelte'
  import { GAP, PAD, type GridLayout } from './shared'

  let { node, g }: { node: FolderNode; g: GridLayout } = $props()
  const excluded = $derived(node.excluded)
</script>

{#snippet grid()}
  {#if node.assets.length > 0}
    <div class="grid" style:grid-template-columns={`repeat(${g.cols}, ${g.cellW}px)`} style:gap={`${GAP}px`}>
      {#each node.assets as a (a.name)}
        <Cell entry={a} board={g.board} width={g.cellW - PAD * 2} active={g.active} names={g.names} withFolder={g.withFolder} />
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
      <FolderName folder={excluded.path} />
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
      <FolderName folder={node.folder} />
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
