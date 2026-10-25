<!--
  Stays mounted (hidden) while the single view is open, so switching back is instant and keeps its
  scroll position. While hidden its board is frozen, so edits don't redraw every cell.
-->
<script lang="ts">
  import { includeFolder } from '../menus'
  import { basename } from '../../lib/paths'
  import { app } from '../../state/app.svelte'
  import Icon from '../../ui/Icon.svelte'
  import GridFolder from './GridFolder.svelte'
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

  // Box select from anywhere that isn't a thumbnail (thumbnails drag to reposition instead).
  // Shift / ⌘ / Ctrl add to the selection. A click without dragging selects or clears. The box is
  // drawn straight onto its element and cells are measured once, so dragging doesn't re-render the
  // grid; the selection only changes when what's inside the box does.
  function onpointerdown(e: PointerEvent) {
    const t = e.target as HTMLElement
    if (e.button !== 0 || t.closest('.frame')) return
    const cellEl = t.closest<HTMLElement>('.cell')
    const additive = e.shiftKey || e.metaKey || e.ctrlKey
    const base = additive ? app.selection : []
    const box = el.getBoundingClientRect()
    const toContent = (cx: number, cy: number) => ({ x: cx - box.left + el.scrollLeft, y: cy - box.top + el.scrollTop })
    const start = toContent(e.clientX, e.clientY)
    const order = app.visible.map((a) => a.name)
    let last = { x: e.clientX, y: e.clientY }
    let dragging = false
    let raf = 0
    let cells: { name: string; x: number; y: number; w: number; h: number }[] = []
    let shown = app.selection
    el.setPointerCapture(e.pointerId)

    const update = () => {
      const p = toContent(last.x, last.y)
      const m = { x: Math.min(start.x, p.x), y: Math.min(start.y, p.y), w: Math.abs(p.x - start.x), h: Math.abs(p.y - start.y) }
      Object.assign(marquee.style, { display: 'block', left: `${m.x}px`, top: `${m.y}px`, width: `${m.w}px`, height: `${m.h}px` })
      const hits = new Set(base)
      for (const c of cells) if (c.x < m.x + m.w && c.x + c.w > m.x && c.y < m.y + m.h && c.y + c.h > m.y) hits.add(c.name)
      const next = order.filter((n) => hits.has(n))
      if (next.length !== shown.length || next.some((n, i) => n !== shown[i])) app.setSelection((shown = next))
    }
    // Scroll while the pointer is held near the top or bottom edge.
    const autoscroll = () => {
      const edge = 40
      const dy = last.y < box.top + edge ? -(box.top + edge - last.y) / 3 : last.y > box.bottom - edge ? (last.y - box.bottom + edge) / 3 : 0
      if (dy) {
        el.scrollTop += dy
        update()
      }
      raf = requestAnimationFrame(autoscroll)
    }
    const move = (ev: PointerEvent) => {
      last = { x: ev.clientX, y: ev.clientY }
      if (!dragging && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 4) return
      if (!dragging) {
        dragging = true
        cells = [...el.querySelectorAll<HTMLElement>('.cell')].map((c) => {
          const r = c.getBoundingClientRect()
          return { name: c.dataset.name!, x: r.left - box.left + el.scrollLeft, y: r.top - box.top + el.scrollTop, w: r.width, h: r.height }
        })
        raf = requestAnimationFrame(autoscroll)
      }
      update()
    }
    const up = () => {
      cancelAnimationFrame(raf)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      marquee.style.display = 'none'
      if (dragging) return
      if (cellEl) app.select(cellEl.dataset.name!, e.shiftKey ? 'range' : e.metaKey || e.ctrlKey ? 'toggle' : 'replace')
      else if (!additive) app.clearSelection()
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
  }
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
