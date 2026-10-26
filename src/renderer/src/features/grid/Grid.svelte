<!--
  Stays mounted (hidden) while the single view is open, so switching back is instant and keeps its
  scroll position. While hidden its board is frozen, so edits don't redraw every cell.
-->
<script lang="ts">
  import { useKeymap } from '../../lib/keymap.svelte'
  import { basename } from '../../lib/paths'
  import { combineSelection, deleteSelection, duplicateSelection, includeFolder, renameItem, setMode, toggleCollapsed } from '../../state/actions'
  import { items } from '../../state/items.svelte'
  import { library } from '../../state/library.svelte'
  import { prioritize } from '../../state/loading'
  import { project } from '../../state/project.svelte'
  import { selection } from '../../state/selection.svelte'
  import { shell } from '../../state/shell.svelte'
  import { view } from '../../state/view.svelte'
  import { Icon } from '../../ui'
  import { GRID } from '../keymaps'
  import { assetMenu, excludedFolderMenu, folderMenu } from '../menus'
  import { layoutScene } from '../scene'
  import { GAP, PAD, provideGrid, scroll } from './context'
  import GridFolder from './GridFolder.svelte'
  import { boxSelect } from './marquee'

  let { active }: { active: boolean } = $props()

  const tree = $derived(view.layout.tree)
  const sectioned = $derived(view.layout.sectioned)
  let frozen = project.board
  const board = $derived.by(() => {
    if (active) frozen = project.board
    return frozen
  })

  let el: HTMLDivElement
  let marquee: HTMLDivElement
  // The scroller's content box: inside its padding and the scrollbar lane (see .grid-scroll).
  let content = $state<DOMRectReadOnly>()
  const width = $derived(content?.width ?? 0)

  // Cells are sized so the artboard's longer side is roughly the thumbnail size.
  const cols = $derived.by(() => {
    const aspect = board.width / board.height
    const target = aspect >= 1 ? view.cellSize : view.cellSize * aspect
    return Math.max(1, Math.floor((width + GAP) / (target + PAD * 2 + GAP)))
  })
  // Exact (fractional) widths, so no rounding leftover piles up on the right.
  const cellW = $derived(width > 0 ? (width - GAP * (cols - 1)) / cols : 0)

  // Arrows move the focus (up and down by position on screen); Space opens it, like Quick Look.
  useKeymap(
    GRID,
    {
      open: { when: () => !!selection.focus, run: () => setMode('single') },
      prev: () => selection.step(-1),
      next: () => selection.step(1),
      up: () => stepRow(-1),
      down: () => stepRow(1),
      duplicate: { when: () => selection.size > 0, run: duplicateSelection },
      combine: { when: () => selection.size > 0, run: combineSelection },
      remove: { when: () => selection.size > 0, run: deleteSelection }
    },
    () => active
  )

  /**
   * To the nearest thumbnail in the next row that way, by position on screen, so folder headers
   * and short last rows don't throw it off.
   */
  function stepRow(dir: 1 | -1): void {
    const cur = el.querySelector<HTMLElement>('.cell.focused')
    if (!cur) return selection.step(dir)
    const r = cur.getBoundingClientRect()
    const cx = r.left + r.width / 2
    let best: { name: string; dy: number; dx: number } | null = null
    for (const c of el.querySelectorAll<HTMLElement>('.cell')) {
      const q = c.getBoundingClientRect()
      const dy = (q.top - r.top) * dir
      if (dy < 2) continue
      const dx = Math.abs(q.left + q.width / 2 - cx)
      if (!best || dy < best.dy - 2 || (Math.abs(dy - best.dy) <= 2 && dx < best.dx)) best = { name: c.dataset.name!, dy, dx }
    }
    if (best) selection.select(best.name)
  }

  provideGrid({
    get cols() {
      return cols
    },
    get cellW() {
      return cellW
    },
    get board() {
      return board
    },
    get active() {
      return active
    },
    get names() {
      return view.prefs.names
    },
    get withFolder() {
      return !view.prefs.group
    },
    get headers() {
      return !!sectioned
    },
    get rootName() {
      return library.dir ? basename(library.dir) : ''
    },
    get previews() {
      return active && !shell.picking
    },
    asset: (entry) => items.with(entry),
    composite: (name) => layoutScene(name, board),
    selected: (name) => selection.has(name),
    focused: (name) => selection.focus === name,
    clip: (name) => project.file.clips[name],
    renaming: (name) => shell.renamingItem === name,
    rename: (name, label) => {
      shell.renamingItem = null
      if (label != null) renameItem(name, label)
    },
    press: (name, mode) => {
      if (mode !== 'replace') selection.select(name, mode)
      else if (selection.has(name)) selection.focus = name
      else selection.select(name)
    },
    click: (name) => selection.select(name),
    open: () => setMode('single'),
    move: (name, patch) => project.edit([name], patch),
    menu: (a, at) => assetMenu(a.name, a.path, at),
    seen: (a) => prioritize(a.path),
    toggleFolder: toggleCollapsed,
    folderMenu,
    excludedMenu: excludedFolderMenu
  })

  const onpointerdown = (e: PointerEvent) => boxSelect(e, el, marquee)

  // Keep the focused thumbnail in view when moving with the keyboard.
  $effect(() => {
    if (view.mode !== 'grid' || !selection.focus) return
    document.querySelector('.cell.focused')?.scrollIntoView({ block: 'nearest' })
  })
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
  {#if cellW > 0}
    {#each tree as node (node.folder || '/')}
      <GridFolder {node} />
    {/each}
  {/if}
  {#if items.all.length > 0 && !tree.length}<div class="empty-hint center">Nothing matches this filter</div>{/if}
  {#if (library.skipped.length > 0 && !sectioned) || library.truncated}
    <div class="grid-foot">
      {#if library.skipped.length > 0 && !sectioned}
        <div class="grid-foot-row">
          <span class="muted">Not shown</span>
          {#each library.skipped as f (f.path)}
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
      {#if library.truncated}<div class="muted">Stopped at 20,000 files. Open a subfolder to see the rest.</div>{/if}
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
    border: 1px solid color-mix(in srgb, var(--accent) 80%, transparent);
    border-radius: 2px;
    background: color-mix(in srgb, var(--accent) 10%, transparent);
    pointer-events: none;
    animation: fade 120ms var(--ease) both;
  }
</style>
