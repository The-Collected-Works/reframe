import { untrack } from 'svelte'
import type { Artboard } from '@shared/types'
import { crossfade, fly, reducedMotion, settledRect, snapshot } from '../../lib/motion'
import type { View } from './camera.svelte'

export interface ZoomOptions {
  stage: () => HTMLElement
  canvas: () => HTMLCanvasElement
  /** The item on screen, by name (its grid thumbnail is found by it). */
  name: () => string | undefined
  /** It has something to show yet (a thumbnail to fly from). */
  drawable: () => boolean
  board: () => Artboard
  /** The stage's size; the flight waits for it to be known. */
  width: () => number
  height: () => number
  /** Where the board settles, and where it is now. */
  target: () => View
  view: () => View
}

/**
 * The stage last torn down, as it looked and where it was: if another takes its place straight
 * away (stepping from a composition to an asset, say, while the single view stays), the new one
 * crossfades from it rather than flying in from the grid.
 */
let handoff: { still: HTMLCanvasElement; rect: DOMRect; at: number } | null = null
const HANDOFF_MS = 500

/** A still of the stage that was there, laid over the host where it was, fading away. */
function fadeFrom(host: HTMLElement, h: { still: HTMLCanvasElement; rect: DOMRect }): void {
  if (reducedMotion()) return
  const at = host.getBoundingClientRect()
  h.still.className = 'flyer'
  Object.assign(h.still.style, {
    left: `${h.rect.left - at.left}px`,
    top: `${h.rect.top - at.top}px`,
    width: `${h.rect.width}px`,
    height: `${h.rect.height}px`
  })
  host.appendChild(h.still)
  h.still.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 180, easing: 'ease-out' }).finished.finally(() => h.still.remove())
}

/**
 * The single view's zoom transitions: the grid thumbnail flies up into the board on enter and back
 * down on exit; stepping between items crossfades (from one kind of stage to the other too). While
 * the flyer is in the air the canvas stays hidden (`entering`). Create it while the stage initialises.
 */
export function zoomTransitions(o: ZoomOptions): { readonly entering: boolean } {
  const dpr = window.devicePixelRatio || 1
  let entering = $state(false)
  let entered = false
  $effect(() => {
    if (entered || !o.width()) return
    entered = true
    untrack(() => {
      const host = o.stage().closest<HTMLElement>('.content')
      // Taking over from another stage: crossfade, as stepping does.
      const from = handoff
      handoff = null
      if (from && performance.now() - from.at < HANDOFF_MS) return void (host && fadeFrom(host, from))
      const name = o.name()
      if (!name || !o.drawable()) return
      const cell = document.querySelector<HTMLCanvasElement>(`.cell[data-name="${CSS.escape(name)}"] canvas[data-ready]`)
      if (!cell || !host) return
      const s0 = o.stage().getBoundingClientRect()
      const t = o.target()
      const b = o.board()
      const to = new DOMRect(s0.left + t.bx, s0.top + t.by, b.width * t.k, b.height * t.k)
      entering = true
      fly(host, snapshot(cell), cell.getBoundingClientRect(), to).then((dismiss) => {
        entering = false
        requestAnimationFrame(dismiss)
      })
    })
  })
  // Where the stage is on screen; by the time the view is torn down it's already out of the page.
  let stageRect = new DOMRect()
  $effect(() => {
    void o.width()
    void o.height()
    stageRect = o.stage().getBoundingClientRect()
  })
  $effect(() => {
    // Hold on to the elements too: their references are cleared as the view is torn down.
    const c = o.canvas()
    const host = o.stage().closest<HTMLElement>('.content')
    return () => {
      // Leaving: capture the board as drawn, then land it on its grid cell once the grid is back.
      const leaving = o.name()
      const { k, bx, by } = o.view()
      const b = o.board()
      if (!c.width || !host) return
      // For a stage taking this one's place (see handoff).
      handoff = { still: snapshot(c), rect: stageRect, at: performance.now() }
      if (!leaving) return
      const w = b.width * k
      const h = b.height * k
      const from = new DOMRect(stageRect.left + bx, stageRect.top + by, w, h)
      const shot = snapshot(c, bx * dpr, by * dpr, w * dpr, h * dpr)
      requestAnimationFrame(() =>
        requestAnimationFrame(async () => {
          // Back to the grid: nothing takes this stage's place.
          if (document.querySelector('.grid-scroll:not(.inactive)')) handoff = null
          // Only if the grid is what's showing now.
          const cell = document.querySelector<HTMLCanvasElement>(`.grid-scroll:not(.inactive) .cell[data-name="${CSS.escape(leaving)}"] canvas`)
          if (!cell) return
          cell.style.opacity = '0'
          // The grid is still growing back from its receded scale; aim for where the cell settles.
          const dismiss = await fly(host, shot, from, settledRect(cell, cell.closest<HTMLElement>('.grid-scroll')!), 300)
          cell.style.opacity = ''
          dismiss()
        })
      )
    }
  })
  // Stepping to another item crossfades from what was on screen (before it's redrawn).
  let shown = untrack(o.name)
  $effect.pre(() => {
    const name = o.name()
    const c = untrack(o.canvas)
    if (shown && name !== shown && c) crossfade(c)
    shown = name
  })
  return {
    get entering() {
      return entering
    }
  }
}
