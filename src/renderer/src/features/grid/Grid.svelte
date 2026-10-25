<!--
  Stays mounted (hidden) while the single view is open, so switching back is instant and keeps its
  scroll position. While hidden its board is frozen, so edits don't redraw every cell.
-->
<script lang="ts">
  import { basename } from '../../lib/paths'
  import { includeFolder } from '../../state/actions'
  import { app } from '../../state/app.svelte'
  import Icon from '../../ui/Icon.svelte'
  import GridFolder from './GridFolder.svelte'
  import { boxSelect } from './marquee'
  import { GAP, PAD, scroll, type GridLayout } from './shared'

  let { active }: { active: boolean } = $props()

  const tree = $derived(app.layout.tree)
  const prefs = $derived(app.viewPrefs)
  // A flat folder needs no headers; as soon as there are subfolders (or excluded ones), every
  // folder gets one.
  const sectioned = $derived(prefs.group && (tree.length > 1 || (tree.length === 1 && tree[0].folder !== '')))
  let frozen = app.board
  const board = $derived.by(() => {
    if (active) frozen = app.board
    return frozen
  })

  let el: HTMLDivElement
  let marquee: HTMLDivElement
  // The scroller's content box: inside its padding and the scrollbar lane (see .grid-scroll).
  let content = $state<DOMRectReadOnly>()
  const width = $derived(content?.width ?? 0)

  // Cells are sized so the artboard's longer side is roughly `cellSize`.
  const g: GridLayout = $derived.by(() => {
    const aspect = board.width / board.height
    const target = aspect >= 1 ? app.cellSize : app.cellSize * aspect
    const cols = Math.max(1, Math.floor((width + GAP) / (target + PAD * 2 + GAP)))
    // Exact (fractional) widths, so no rounding leftover piles up on the right.
    const cellW = width > 0 ? (width - GAP * (cols - 1)) / cols : 0
    return {
      cols,
      cellW,
      board,
      active,
      names: prefs.names,
      withFolder: !prefs.group,
      headers: !!sectioned,
      rootName: app.dir ? basename(app.dir) : ''
    }
  })

  const onpointerdown = (e: PointerEvent) => boxSelect(e, el, marquee)
</script>

<div
  bind:this={el}
  bind:contentRect={content}
  class={['grid-scroll', { sectioned, inactive: !active }]}
  role="presentation"
  {onpointerdown}
  onscroll={() => (scroll.last = performance.now())}
>
  <!-- The folders as the tree they are: each holds its header, its own thumbnails and its
       subfolders, so folding, hover tints and sticky headers all follow from the nesting. -->
  {#if g.cellW > 0}
    {#each tree as node (node.folder || '/')}
      <GridFolder {node} {g} />
    {/each}
  {/if}
  {#if app.assets.length > 0 && !tree.length}<div class="empty-hint center">Nothing matches this filter</div>{/if}
  {#if (app.skipped.length > 0 && !sectioned) || app.truncated}
    <div class="grid-foot">
      {#if app.skipped.length > 0 && !sectioned}
        <div class="grid-foot-row">
          <span class="muted">Not shown</span>
          {#each app.skipped as f (f.path)}
            <button
              class="skipped-folder"
              title={`${f.reason === 'export' ? 'Reframe exports' : 'Excluded'}. Click to include it`}
              onclick={() => includeFolder(f.path)}
            >
              <Icon name="folder" size={12} />
              {f.path.split('/').join(' / ')}
              <span class="muted">{f.reason === 'export' ? 'exports' : 'excluded'}</span>
            </button>
          {/each}
        </div>
      {/if}
      {#if app.truncated}<div class="muted">Stopped at 20,000 files. Open a subfolder to see the rest.</div>{/if}
    </div>
  {/if}
  <div class="marquee" bind:this={marquee}></div>
</div>
