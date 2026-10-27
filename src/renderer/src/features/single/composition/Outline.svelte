<!--
  A composition's structure as an outline (in the single view's left panel): its groups (side by
  side, or stacked) and cells, indented under the group they're in. Click a row to select it,
  shift-click to add it to the selection; hovering one shows it on the stage. Drag a row to move it:
  between two rows, it goes there in their group; onto the middle of a group's row, to the end of
  that group. The stage shows where it would land while it's dragged (`onLanding`). Takes props.
-->
<script lang="ts">
  import type { Attachment } from 'svelte/attachments'
  import { isSplit, within, type DirOf } from '@shared/composition/bento'
  import type { BentoNode } from '@shared/types'
  import { trackPointer } from '../../../lib/drag'
  import { Icon } from '../../../ui'

  /** What a cell row shows: what's in the cell, and its picture. */
  export interface CellInfo {
    label: string
    thumb: CanvasImageSource | null
    w: number
    h: number
  }
  type Into = { parent: string; index: number }

  let {
    root,
    dirOf,
    cellOf,
    selected,
    hover,
    onSelect,
    onHover,
    onFlip,
    onLanding,
    onDrop
  }: {
    root: BentoNode
    /** Which way each group runs on this artboard (Auto ones as they're placed). */
    dirOf: DirOf
    cellOf: (slot: string) => CellInfo | null
    selected: string[]
    hover: string | null
    /** A row clicked; `add`: shift-click, adding it to the selection (or taking it out). */
    onSelect: (id: string, add: boolean) => void
    onHover: (id: string | null) => void
    onFlip: (group: string) => void
    /** Mid-drag: where row `moving` would land (null: nowhere). */
    onLanding: (moving: string | null, into: Into | null) => void
    onDrop: (moving: string, into: Into) => void
  } = $props()

  const INDENT = 14
  let list = $state<HTMLDivElement>()

  type Row = { node: BentoNode; depth: number; parent: string | null; index: number }
  const rows = $derived.by(() => {
    const out: Row[] = []
    const walk = (n: BentoNode, depth: number, parent: string | null, index: number) => {
      out.push({ node: n, depth, parent, index })
      if (isSplit(n)) n.children.forEach((c, i) => walk(c, depth + 1, n.id, i))
    }
    walk(root, 0, null, 0)
    return out
  })

  // Dragging a row: which one, and where the line showing where it lands goes.
  let dragging = $state<string | null>(null)
  let marker = $state<{ y: number; depth: number; into: string | null } | null>(null)

  /** Where a row dragged to `clientY` lands, or null (on itself, or inside itself). */
  function landing(moving: string, clientY: number): { into: Into; marker: { y: number; depth: number; into: string | null } } | null {
    if (!list) return null
    const els = [...list.querySelectorAll<HTMLElement>('[data-row]')]
    const top = list.getBoundingClientRect().top - list.scrollTop
    for (const el of els) {
      const r = el.getBoundingClientRect()
      if (clientY > r.bottom && el !== els[els.length - 1]) continue
      const row = rows[Number(el.dataset.row)]
      if (within(root, moving, row.node.id)) return null
      const u = (clientY - r.top) / r.height
      // The middle of a group's row: to its end.
      if (isSplit(row.node) && ((u > 0.3 && u < 0.7) || !row.parent))
        return { into: { parent: row.node.id, index: row.node.children.length }, marker: { y: 0, depth: row.depth, into: row.node.id } }
      if (!row.parent) return null
      const before = u < 0.5
      return {
        into: { parent: row.parent, index: row.index + (before ? 0 : 1) },
        marker: { y: (before ? r.top : r.bottom) - top, depth: row.depth, into: null }
      }
    }
    return null
  }

  function press(e: PointerEvent, id: string) {
    if (e.button !== 0) return
    const add = e.shiftKey || e.metaKey || e.ctrlKey
    let into: Into | null = null
    trackPointer(e, {
      slop: 4,
      start: () => (dragging = id),
      move: (ev) => {
        const l = landing(id, ev.clientY)
        into = l?.into ?? null
        marker = l?.marker ?? null
        onLanding(id, into)
      },
      end: (dragged) => {
        dragging = null
        marker = null
        onLanding(null, null)
        if (!dragged) return onSelect(id, add)
        if (into) onDrop(id, into)
      }
    })
  }

  /** A cell's picture, filling its square. */
  const thumb =
    (c: CellInfo | null): Attachment<HTMLCanvasElement> =>
    (canvas) => {
      const dpr = window.devicePixelRatio || 1
      const size = 16 * dpr
      canvas.width = canvas.height = size
      const ctx = canvas.getContext('2d')!
      ctx.clearRect(0, 0, size, size)
      if (!c?.thumb || !c.w) return
      const s = Math.max(size / c.w, size / c.h)
      ctx.drawImage(c.thumb, (size - c.w * s) / 2, (size - c.h * s) / 2, c.w * s, c.h * s)
    }
</script>

<div
  class="outline"
  role="tree"
  tabindex="-1"
  aria-label="Structure"
  bind:this={list}
  onpointerdown={(e) => e.stopPropagation()}
  onwheel={(e) => e.stopPropagation()}
  onpointerleave={() => onHover(null)}
>
  {#each rows as row, i (row.node.id)}
    {@const node = row.node}
    {@const cell = isSplit(node) ? null : cellOf(node.id)}
    <div
      class={['row', { on: selected.includes(node.id), hovered: node.id === hover, moving: dragging === node.id, into: marker?.into === node.id }]}
      role="treeitem"
      aria-selected={selected.includes(node.id)}
      tabindex="-1"
      data-row={i}
      style:padding-left={`${4 + row.depth * INDENT}px`}
      onpointerdown={(e) => press(e, node.id)}
      onpointerenter={() => !dragging && onHover(node.id)}
    >
      <!-- A faint line down each level it's inside. -->
      {#each { length: row.depth } as _, d (d)}<span class="guide" style:left={`${11 + d * INDENT}px`}></span>{/each}
      {#if isSplit(node)}
        <button
          class="dir"
          title={dirOf(node) === 'row' ? 'Side by side: click to stack them' : 'Stacked: click to put them side by side'}
          onpointerdown={(e) => e.stopPropagation()}
          onclick={() => onFlip(node.id)}
        >
          <Icon name={dirOf(node) === 'row' ? 'splitRow' : 'splitCol'} size={13} />
        </button>
        <span class="name group">{dirOf(node) === 'row' ? 'Side by side' : 'Stacked'}</span>
        {#if !node.dir}<span class="auto" title="Follows each artboard's shape">auto</span>{/if}
      {:else}
        <canvas class="thumb" {@attach thumb(cell)}></canvas>
        <span class={['name', { empty: !node.item }]}>{node.item ? (cell?.label ?? '…') : 'Empty'}</span>
      {/if}
    </div>
  {/each}
  {#if marker && !marker.into}
    <div class="marker" style:top={`${marker.y - 1}px`} style:left={`${4 + marker.depth * INDENT}px`}></div>
  {/if}
</div>

<style>
  .outline {
    position: relative;
    outline: none;
  }

  .row {
    position: relative;
    display: flex;
    align-items: center;
    gap: 7px;
    height: 26px;
    padding-right: 8px;
    border-radius: 6px;
    color: var(--muted);
    font-size: 12px;
    cursor: default;
    user-select: none;
    transition:
      background-color var(--t-fast) var(--ease),
      color var(--t-fast) var(--ease),
      opacity var(--t-fast) var(--ease);
  }

  .row.hovered {
    color: var(--text);
    background: var(--tint-1);
  }

  .row.on {
    color: var(--text);
    background: var(--accent-soft);
  }

  .row.moving {
    opacity: 0.35;
  }

  /* Dropping into this group: it lights up. */
  .row.into {
    box-shadow: inset 0 0 0 1.5px var(--accent);
  }

  .guide {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 1px;
    background: var(--line);
    pointer-events: none;
  }

  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .name.group {
    flex: none;
  }

  .name.empty {
    color: var(--faint);
    font-style: italic;
  }

  .dir {
    flex: none;
    display: grid;
    place-items: center;
    width: 16px;
    height: 20px;
    border-radius: 4px;
    color: var(--faint);
    cursor: pointer;
    transition: color var(--t-fast) var(--ease);
  }

  .dir:hover,
  .row.on .dir {
    color: var(--accent);
  }

  .auto {
    color: var(--faint);
    font-size: 10px;
  }

  .thumb {
    flex: none;
    width: 16px;
    height: 16px;
    border-radius: 3px;
    background: var(--tint-2);
  }

  /* Where a dragged row would go: a line between rows, indented to its group. */
  .marker {
    position: absolute;
    right: 4px;
    height: 2px;
    border-radius: 1px;
    background: var(--accent);
    pointer-events: none;
  }

  .marker::before {
    content: '';
    position: absolute;
    left: -3px;
    top: -2px;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent);
  }
</style>
