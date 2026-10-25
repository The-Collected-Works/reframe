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

<style>
  .grid-scroll {
    position: absolute;
    inset: 0;
    overflow-y: auto;
    /* Never sideways: while the window is resized, cells are a frame late to shrink, which would
       otherwise flash a horizontal scrollbar. */
    overflow-x: hidden;
    /* The scrollbar's lane is reserved whether or not it scrolls, so the width never changes. Only
       on the right, where the scrollbar is: a lane on the left too would keep section headers from
       reaching the edge, so the left gets the same 10px as padding instead. With the cells' 10px
       mat, frame-to-edge is 36px on every side: 26 + 10 top, bottom and left; 16 + 10 lane + 10 on
       the right. */
    scrollbar-gutter: stable;
    padding: 26px 16px 26px 26px;
    /* Grid ⇄ single view: the grid recedes while the zoom flies over it. */
    transition:
      opacity var(--t-med) var(--ease),
      transform var(--t-slow) var(--ease),
      visibility 0s;
  }

  /* With folders, the cards sit 16px from the top and bottom too, as from the sides. Moving through
     thumbnails with the keyboard keeps the focused one clear of the stuck header above. */
  .sectioned {
    padding-block: 16px;
    scroll-padding-top: 62px;
  }

  .inactive {
    visibility: hidden;
    pointer-events: none;
    opacity: 0;
    transform: scale(0.985);
    transition:
      opacity var(--t-med) var(--ease),
      transform var(--t-slow) var(--ease),
      visibility 0s linear var(--t-slow);
  }

  /* Below the grid: folders the scan left out (click one to include it again), and the file limit. */
  .grid-foot {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 28px;
    padding: 0 10px;
    font-size: 11px;
  }

  .grid-foot-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
  }

  .skipped-folder {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 24px;
    padding: 0 8px;
    border-radius: 6px;
    background: var(--tint-1);
    color: var(--text);
    font-size: 11px;
    transition: background-color var(--t-fast) var(--ease);
  }

  .skipped-folder :global(svg) {
    color: var(--muted);
  }

  .skipped-folder:hover {
    background: var(--tint-2);
  }

  .marquee {
    display: none;
    position: absolute;
    z-index: 5;
    border: 1px solid rgba(110, 155, 255, 0.8);
    border-radius: 2px;
    background: rgba(110, 155, 255, 0.1);
    pointer-events: none;
    animation: fade 120ms var(--ease) both;
  }
</style>
