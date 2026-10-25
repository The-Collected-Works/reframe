import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { drawFrame, resolveSettings } from '@shared/layout'
import type { Artboard, AssetEntry } from '@shared/types'
import { observeVisibility, scheduleDraw } from '../lazydraw'
import { prioritize } from '../media'
import { reducedMotion } from '../motion'
import { useBoard, useStore, useVisible, withMeta } from '../store'

const HEIGHT = 52
/** Matches .film-item padding and .film-scroll gap. */
const ITEM_PAD = 3
const GAP = 2
/** Window width in items: the active one, one either side, one more each side fading out. */
const VISIBLE = 5
/** Duration of the glide to a newly selected item. */
const GLIDE_MS = 700
/** How far a fling carries: release velocity (px/ms) × this. */
const MOMENTUM_MS = 220

/**
 * A short, fixed-width window of artboard-shaped thumbnails under the single view: the active one
 * centred, one either side, and one more each side fading out. It reads as a static element while
 * its contents glide as the selection changes. Padding of half its width on each side lets even
 * the first and last items reach the centre.
 */
export function Filmstrip() {
  // What the grid shows, in its order (filtered, sorted, collapsed folders left out).
  const assets = useVisible()
  const focus = useStore((s) => s.focus)
  const board = useBoard()
  const strip = useRef<HTMLDivElement>(null)
  const [pad, setPad] = useState(0)
  const itemWidth = Math.round((HEIGHT * board.width) / board.height) + ITEM_PAD * 2
  const step = itemWidth + GAP

  useLayoutEffect(() => {
    const el = strip.current!
    const ro = new ResizeObserver(() => setPad(Math.max(0, (el.clientWidth - itemWidth) / 2)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [itemWidth])

  // Centre the active item: instantly the first time, gliding after that. The glide is an
  // exponential ease-out: it leaves at full speed and spends most of its time settling.
  // A new target mid-glide restarts from wherever it is, so rapid stepping never jumps.
  const placed = useRef(false)
  const glide = useRef(0)
  const centre = () => {
    const el = strip.current!
    const on = el.querySelector<HTMLElement>('.film-item.on')
    if (!on || !pad) return
    const to = on.offsetLeft + on.offsetWidth / 2 - el.clientWidth / 2
    cancelAnimationFrame(glide.current)
    if (!placed.current || reducedMotion()) {
      el.scrollLeft = to
      placed.current = true
      return
    }
    const from = el.scrollLeft
    const t0 = performance.now()
    const tick = () => {
      const t = Math.min(1, (performance.now() - t0) / GLIDE_MS)
      el.scrollLeft = from + (to - from) * (t === 1 ? 1 : 1 - Math.pow(2, -10 * t))
      if (t < 1) glide.current = requestAnimationFrame(tick)
    }
    glide.current = requestAnimationFrame(tick)
  }
  useLayoutEffect(centre, [focus, pad, itemWidth])
  useEffect(() => () => cancelAnimationFrame(glide.current), [])

  /** Selects the item that would sit nearest the centre if the strip were scrolled to `scrollLeft`. */
  const settleAt = (scrollLeft: number) => {
    const el = strip.current!
    const i = Math.round((scrollLeft + el.clientWidth / 2 - pad - itemWidth / 2) / step)
    const target = assets[Math.max(0, Math.min(assets.length - 1, i))]
    if (target && target.name !== focus) useStore.getState().select(target.name)
    else centre()
  }
  const settleRef = useRef(settleAt)
  settleRef.current = settleAt

  // Drag like a picker: the strip follows the pointer and, on release, carries its momentum to
  // the nearest item and selects it (the glide above then finishes the motion). A click that
  // never moved still selects the thumbnail under it.
  const swallowClick = useRef(false)
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    const el = strip.current!
    const x0 = e.clientX
    const left0 = el.scrollLeft
    let dragging = false
    let samples: { t: number; x: number }[] = [{ t: performance.now(), x: e.clientX }]
    const move = (ev: PointerEvent) => {
      if (!dragging && Math.abs(ev.clientX - x0) < 4) return
      if (!dragging) {
        dragging = true
        cancelAnimationFrame(glide.current)
        el.setPointerCapture(e.pointerId)
        el.classList.add('dragging')
      }
      el.scrollLeft = left0 - (ev.clientX - x0)
      const now = performance.now()
      samples = [...samples.filter((p) => now - p.t < 80), { t: now, x: ev.clientX }]
    }
    const up = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      if (!dragging) return
      el.classList.remove('dragging')
      swallowClick.current = true
      const first = samples[0]
      const last = samples[samples.length - 1]
      const velocity = last.t > first.t ? (last.x - first.x) / (last.t - first.t) : 0 // px/ms
      settleRef.current(el.scrollLeft - velocity * MOMENTUM_MS)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
  }
  const onClickCapture = (e: React.MouseEvent) => {
    if (!swallowClick.current) return
    swallowClick.current = false
    e.stopPropagation()
    e.preventDefault()
  }

  // The wheel scrolls the strip, then settles on the nearest item once scrolling stops.
  useEffect(() => {
    const el = strip.current!
    let idle: ReturnType<typeof setTimeout> | undefined
    const wheel = (e: WheelEvent) => {
      const d = Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX
      if (!d) return
      e.preventDefault()
      cancelAnimationFrame(glide.current)
      el.scrollLeft += d
      clearTimeout(idle)
      idle = setTimeout(() => settleRef.current(el.scrollLeft), 140)
    }
    el.addEventListener('wheel', wheel, { passive: false })
    return () => {
      clearTimeout(idle)
      el.removeEventListener('wheel', wheel)
    }
  }, [])

  return (
    <div
      className="film-scroll"
      ref={strip}
      onPointerDown={onPointerDown}
      onClickCapture={onClickCapture}
      style={{ width: step * VISIBLE, paddingLeft: pad, paddingRight: pad, ['--item' as string]: `${step}px` }}
    >
      {assets.map((a) => (
        <Thumb key={a.name} entry={a} board={board} on={a.name === focus} />
      ))}
    </div>
  )
}

const Thumb = memo(function Thumb({ entry, board, on }: { entry: AssetEntry; board: Artboard; on: boolean }) {
  const meta = useStore((s) => s.meta[entry.name])
  const asset = useMemo(() => withMeta(entry, meta), [entry, meta])
  const canvas = useRef<HTMLCanvasElement>(null)
  const visible = useRef(false)
  const drawn = useRef('')
  const settings = resolveSettings(board, asset.name)
  const height = HEIGHT
  const width = Math.round((HEIGHT * board.width) / board.height)
  const dpr = window.devicePixelRatio || 1
  const key = `${JSON.stringify(settings)}|${width}x${height}@${dpr}|${asset.w}x${asset.h}|${asset.mtime}|${!!asset.thumb}`

  const draw = () => {
    const c = canvas.current
    if (!c || !asset.thumb) return
    const pw = Math.round(width * dpr)
    const ph = Math.round(height * dpr)
    if (c.width !== pw || c.height !== ph) {
      c.width = pw
      c.height = ph
    }
    drawFrame(c.getContext('2d')!, asset.thumb, asset.w, asset.h, board.width, board.height, settings, pw / board.width)
    c.dataset.ready = '1'
    drawn.current = key
  }
  const drawRef = useRef(draw)
  drawRef.current = draw
  const task = useRef(() => drawRef.current()).current
  const request = () => {
    if (visible.current && drawn.current !== key) scheduleDraw(task)
  }
  const requestRef = useRef(request)
  requestRef.current = request
  useEffect(request)
  useEffect(
    () =>
      observeVisibility(canvas.current!, (v) => {
        visible.current = v
        if (v && !asset.thumb) prioritize(asset.path)
        requestRef.current()
      }),
    [asset.path, asset.thumb]
  )

  return (
    <button
      tabIndex={-1}
      className={'film-item' + (on ? ' on' : '') + (settings.skip ? ' skipped' : '')}
      title={asset.name}
      onClick={() => useStore.getState().select(asset.name)}
    >
      <canvas ref={canvas} style={{ width, height }} />
    </button>
  )
})
