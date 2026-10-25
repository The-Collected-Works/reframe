import { selection } from '../../state/selection.svelte'
import { view } from '../../state/view.svelte'
import { clearSelection } from '../../state/actions'

/**
 * Box select from anywhere in the grid that isn't a thumbnail (thumbnails drag to reposition
 * instead). Shift / ⌘ / Ctrl add to the selection. A click without dragging selects or clears.
 * The box is drawn straight onto `marquee` and cells are measured once, so dragging doesn't
 * re-render the grid; the selection only changes when what's inside the box does.
 */
export function boxSelect(e: PointerEvent, el: HTMLElement, marquee: HTMLElement): void {
  const t = e.target as HTMLElement
  if (e.button !== 0 || t.closest('.frame')) return
  const cellEl = t.closest<HTMLElement>('.cell')
  const additive = e.shiftKey || e.metaKey || e.ctrlKey
  const base = additive ? selection.names : []
  const box = el.getBoundingClientRect()
  const toContent = (cx: number, cy: number) => ({ x: cx - box.left + el.scrollLeft, y: cy - box.top + el.scrollTop })
  const start = toContent(e.clientX, e.clientY)
  const order = view.visible.map((a) => a.name)
  let last = { x: e.clientX, y: e.clientY }
  let dragging = false
  let raf = 0
  let cells: { name: string; x: number; y: number; w: number; h: number }[] = []
  let shown = selection.names
  el.setPointerCapture(e.pointerId)

  const update = () => {
    const p = toContent(last.x, last.y)
    const m = { x: Math.min(start.x, p.x), y: Math.min(start.y, p.y), w: Math.abs(p.x - start.x), h: Math.abs(p.y - start.y) }
    Object.assign(marquee.style, { display: 'block', left: `${m.x}px`, top: `${m.y}px`, width: `${m.w}px`, height: `${m.h}px` })
    const hits = new Set(base)
    for (const c of cells) if (c.x < m.x + m.w && c.x + c.w > m.x && c.y < m.y + m.h && c.y + c.h > m.y) hits.add(c.name)
    const next = order.filter((n) => hits.has(n))
    if (next.length !== shown.length || next.some((n, i) => n !== shown[i])) selection.set((shown = next))
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
    if (cellEl) selection.select(cellEl.dataset.name!, e.shiftKey ? 'range' : e.metaKey || e.ctrlKey ? 'toggle' : 'replace')
    else if (!additive) clearSelection()
  }
  el.addEventListener('pointermove', move)
  el.addEventListener('pointerup', up)
  el.addEventListener('pointercancel', up)
}
