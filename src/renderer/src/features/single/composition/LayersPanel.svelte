<!--
  A composition's layers, floating over the stage: its groups (side by side, or stacked) and cells
  as an outline. Click a row to select it; hovering one shows it on the stage. Drag a row to move it:
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
    open = $bindable(true),
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
    /** Showing its rows (else just its title). */
    open?: boolean
    root: BentoNode
    /** Which way each group runs on this artboard (Auto ones as they're placed). */
    dirOf: DirOf
    cellOf: (slot: string) => CellInfo | null
    selected: string | null
    hover: string | null
    onSelect: (id: string) => void
    onHover: (id: string | null) => void
    onFlip: (group: string) => void
    /** Mid-drag: where row `moving` would land (null: nowhere). */
    onLanding: (moving: string | null, into: Into | null) => void
    onDrop: (moving: string, into: Into) => void
  } = $props()

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

  // Dragging a row: which one, where it would land, and where the line showing that goes.
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
      const y = (before: boolean) => (before ? r.top : r.bottom) - top
      // The middle of a group's row: to its end.
      if (isSplit(row.node) && ((u > 0.3 && u < 0.7) || !row.parent))
        return { into: { parent: row.node.id, index: row.node.children.length }, marker: { y: 0, depth: row.depth, into: row.node.id } }
      if (!row.parent) return null
      const before = u < 0.5
      return { into: { parent: row.parent, index: row.index + (before ? 0 : 1) }, marker: { y: y(before), depth: row.depth, into: null } }
    }
    return null
  }

  function press(e: PointerEvent, id: string) {
    if (e.button !== 0) return
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
        if (!dragged) return onSelect(id)
        if (into) onDrop(id, into)
      }
    })
  }

  /** A cell's picture, filling its square. */
  const thumb =
    (c: CellInfo | null): Attachment<HTMLCanvasElement> =>
    (canvas) => {
      const dpr = window.devicePixelRatio || 1
      const size = 22 * dpr
      canvas.width = canvas.height = size
      const ctx = canvas.getContext('2d')!
      ctx.clearRect(0, 0, size, size)
      if (!c?.thumb || !c.w) return
      const s = Math.max(size / c.w, size / c.h)
      ctx.drawImage(c.thumb, (size - c.w * s) / 2, (size - c.h * s) / 2, c.w * s, c.h * s)
    }
</script>

<div class={['layers', { closed: !open }]} role="presentation" onpointerdown={(e) => e.stopPropagation()} onwheel={(e) => e.stopPropagation()}>
  <button class="head" onclick={() => (open = !open)} title={open ? 'Hide the layers' : 'Show the layers'}>
    <span>Layers</span>
    <span class={['chev', { open }]}><Icon name="chevronDown" size={13} /></span>
  </button>
  {#if open}
    <div class="list" role="tree" tabindex="-1" bind:this={list} onpointerleave={() => onHover(null)}>
      {#each rows as row, i (row.node.id)}
        {@const node = row.node}
        {@const cell = isSplit(node) ? null : cellOf(node.id)}
        <div
          class={['row', { on: node.id === selected, hovered: node.id === hover, moving: dragging === node.id, into: marker?.into === node.id }]}
          role="treeitem"
          aria-selected={node.id === selected}
          tabindex="-1"
          data-row={i}
          style:padding-left={`${6 + row.depth * 14}px`}
          onpointerdown={(e) => press(e, node.id)}
          onpointerenter={() => !dragging && onHover(node.id)}
        >
          {#if isSplit(node)}
            <button
              class="dir"
              title={dirOf(node) === 'row' ? 'Side by side: click to stack them' : 'Stacked: click to put them side by side'}
              onpointerdown={(e) => e.stopPropagation()}
              onclick={() => onFlip(node.id)}
            >
              <Icon name={dirOf(node) === 'row' ? 'splitRow' : 'splitCol'} size={13} />
            </button>
            <span class="name">{dirOf(node) === 'row' ? 'Side by side' : 'Stacked'}</span>
            {#if !node.dir}<span class="auto" title="Follows each artboard's shape">Auto</span>{/if}
            <span class="count">{node.children.length}</span>
          {:else}
            <canvas class="thumb" {@attach thumb(cell)}></canvas>
            <span class={['name', { empty: !node.item }]}>{node.item ? (cell?.label ?? '…') : 'Empty'}</span>
          {/if}
        </div>
      {/each}
      {#if marker && !marker.into}
        <div class="marker" style:top={`${marker.y - 1}px`} style:left={`${6 + marker.depth * 14}px`}></div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .layers {
    position: absolute;
    top: 12px;
    left: 12px;
    z-index: 5;
    width: 220px;
    max-height: calc(100% - 190px);
    display: flex;
    flex-direction: column;
    border-radius: 12px;
    background: var(--glass-bg);
    backdrop-filter: var(--glass-filter);
    box-shadow: var(--glass-shadow);
    overflow: hidden;
    animation: rise-in 300ms var(--ease) 100ms both;
  }

  .layers.closed {
    width: 120px;
  }

  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 34px;
    padding: 0 10px 0 12px;
    color: var(--muted);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.02em;
  }

  .head:hover {
    color: var(--text);
  }

  .chev {
    display: grid;
    transform: rotate(-90deg);
    transition: transform var(--t-med) var(--ease);
  }

  .chev.open {
    transform: none;
  }

  .list {
    position: relative;
    overflow-y: auto;
    padding: 0 6px 6px;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 30px;
    padding-right: 8px;
    border-radius: 7px;
    color: var(--muted);
    font-size: 12px;
    cursor: grab;
    user-select: none;
    transition:
      background-color var(--t-fast) var(--ease),
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
    opacity: 0.4;
  }

  /* Dropping into this group: it lights up. */
  .row.into {
    box-shadow: inset 0 0 0 1.5px var(--accent);
  }

  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .name.empty {
    color: var(--faint);
    font-style: italic;
  }

  .dir {
    flex: none;
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    margin-left: -2px;
    border-radius: 5px;
    color: var(--muted);
    cursor: pointer;
  }

  .dir:hover {
    color: var(--accent);
    background: var(--tint-2);
  }

  .row.on .dir {
    color: var(--accent);
  }

  .auto {
    padding: 1px 5px;
    border-radius: 4px;
    background: var(--tint-2);
    color: var(--faint);
    font-size: 10px;
  }

  .count {
    color: var(--faint);
    font-variant-numeric: tabular-nums;
  }

  .thumb {
    flex: none;
    width: 22px;
    height: 22px;
    border-radius: 4px;
    background: var(--tint-2);
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08);
  }

  /* Where a dragged row would go: a line between rows, indented to its group. */
  .marker {
    position: absolute;
    right: 6px;
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
