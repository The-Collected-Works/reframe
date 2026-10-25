<!--
  A short, fixed-width window of artboard-shaped thumbnails under the single view: the active one
  centred, one either side, and one more each side fading out. It reads as a static element while
  its contents glide as the selection changes. Padding of half its width on each side lets even the
  first and last items reach the centre.
-->
<script lang="ts">
  import { reducedMotion } from '../motion'
  import { app } from '../store.svelte'
  import FilmThumb from './FilmThumb.svelte'
  import { FILM_GAP, FILM_HEIGHT, FILM_PAD } from './film'

  /** Window width in items: the active one, one either side, one more each side fading out. */
  const VISIBLE = 5
  /** Duration of the glide to a newly selected item. */
  const GLIDE_MS = 700
  /** How far a fling carries: release velocity (px/ms) × this. */
  const MOMENTUM_MS = 220

  // What the grid shows, in its order (filtered, sorted, collapsed folders left out).
  const assets = $derived(app.visible)
  const board = $derived(app.board)
  let strip: HTMLDivElement
  let pad = $state(0)
  const itemWidth = $derived(Math.round((FILM_HEIGHT * board.width) / board.height) + FILM_PAD * 2)
  const step = $derived(itemWidth + FILM_GAP)

  $effect(() => {
    const w = itemWidth
    const ro = new ResizeObserver(() => (pad = Math.max(0, (strip.clientWidth - w) / 2)))
    ro.observe(strip)
    return () => ro.disconnect()
  })

  // Centre the active item: instantly the first time, gliding after that. The glide is an
  // exponential ease-out: it leaves at full speed and spends most of its time settling. A new
  // target mid-glide restarts from wherever it is, so rapid stepping never jumps.
  let placed = false
  let glide = 0
  function centre() {
    const on = strip.querySelector<HTMLElement>('.film-item.on')
    if (!on || !pad) return
    const to = on.offsetLeft + on.offsetWidth / 2 - strip.clientWidth / 2
    cancelAnimationFrame(glide)
    if (!placed || reducedMotion()) {
      strip.scrollLeft = to
      placed = true
      return
    }
    const from = strip.scrollLeft
    const t0 = performance.now()
    const tick = () => {
      const t = Math.min(1, (performance.now() - t0) / GLIDE_MS)
      strip.scrollLeft = from + (to - from) * (t === 1 ? 1 : 1 - Math.pow(2, -10 * t))
      if (t < 1) glide = requestAnimationFrame(tick)
    }
    glide = requestAnimationFrame(tick)
  }
  $effect(() => {
    void app.focus
    void pad
    void itemWidth
    centre()
  })
  $effect(() => () => cancelAnimationFrame(glide))

  /** Selects the item that would sit nearest the centre if the strip were scrolled to `scrollLeft`. */
  function settleAt(scrollLeft: number) {
    const i = Math.round((scrollLeft + strip.clientWidth / 2 - pad - itemWidth / 2) / step)
    const target = assets[Math.max(0, Math.min(assets.length - 1, i))]
    if (target && target.name !== app.focus) app.select(target.name)
    else centre()
  }

  // Drag like a picker: the strip follows the pointer and, on release, carries its momentum to the
  // nearest item and selects it (the glide above then finishes the motion). A click that never
  // moved still selects the thumbnail under it.
  let swallowClick = false
  function onpointerdown(e: PointerEvent) {
    if (e.button !== 0) return
    const x0 = e.clientX
    const left0 = strip.scrollLeft
    let dragging = false
    let samples: { t: number; x: number }[] = [{ t: performance.now(), x: e.clientX }]
    const move = (ev: PointerEvent) => {
      if (!dragging && Math.abs(ev.clientX - x0) < 4) return
      if (!dragging) {
        dragging = true
        cancelAnimationFrame(glide)
        strip.setPointerCapture(e.pointerId)
        strip.classList.add('dragging')
      }
      strip.scrollLeft = left0 - (ev.clientX - x0)
      const now = performance.now()
      samples = [...samples.filter((p) => now - p.t < 80), { t: now, x: ev.clientX }]
    }
    const up = () => {
      strip.removeEventListener('pointermove', move)
      strip.removeEventListener('pointerup', up)
      strip.removeEventListener('pointercancel', up)
      if (!dragging) return
      strip.classList.remove('dragging')
      swallowClick = true
      const first = samples[0]
      const last = samples[samples.length - 1]
      const velocity = last.t > first.t ? (last.x - first.x) / (last.t - first.t) : 0 // px/ms
      settleAt(strip.scrollLeft - velocity * MOMENTUM_MS)
    }
    strip.addEventListener('pointermove', move)
    strip.addEventListener('pointerup', up)
    strip.addEventListener('pointercancel', up)
  }
  function onclickcapture(e: MouseEvent) {
    if (!swallowClick) return
    swallowClick = false
    e.stopPropagation()
    e.preventDefault()
  }

  // The wheel scrolls the strip, then settles on the nearest item once scrolling stops.
  $effect(() => {
    let idle: ReturnType<typeof setTimeout> | undefined
    const wheel = (e: WheelEvent) => {
      const d = Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX
      if (!d) return
      e.preventDefault()
      cancelAnimationFrame(glide)
      strip.scrollLeft += d
      clearTimeout(idle)
      idle = setTimeout(() => settleAt(strip.scrollLeft), 140)
    }
    strip.addEventListener('wheel', wheel, { passive: false })
    return () => {
      clearTimeout(idle)
      strip.removeEventListener('wheel', wheel)
    }
  })
</script>

<div
  class="film-scroll"
  role="presentation"
  bind:this={strip}
  {onpointerdown}
  {onclickcapture}
  style:width={`${step * VISIBLE}px`}
  style:padding-left={`${pad}px`}
  style:padding-right={`${pad}px`}
  style:--item={`${step}px`}
>
  {#each assets as a (a.name)}
    <FilmThumb entry={a} {board} on={a.name === app.focus} />
  {/each}
</div>
