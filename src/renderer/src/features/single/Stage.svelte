<!--
  The single view's canvas: the artboard with its media, framed by the camera, and the transform
  gizmo (Figma-style: handles, the overflow ghost and the framing that keeps the handles on screen
  appear only while the media is selected; click it to select, click empty space or Esc to deselect).
-->
<script lang="ts">
  import { untrack } from 'svelte'
  import { bounds, computeLayout, type Point } from '@shared/layout'
  import { combo, MOD } from '../../lib/keys'
  import { crossfade, fly, settledRect, snapshot } from '../../lib/motion'
  import { app, type Asset } from '../../state/app.svelte'
  import { loadStill } from '../../state/loading'
  import { assetMenu } from '../menus'
  import { camera, type View } from './camera.svelte'
  import { dragTo, hitTest, type DragStart } from './gizmo'
  import type { Player } from './player.svelte'
  import { bitmapProxy } from './proxy.svelte'
  import { drawStage } from './render'
  import { NO_GUIDES, snapZoom, zoomAbout, type Guides } from './snapping'

  let { asset, player }: { asset: Asset | undefined; player: Player | null } = $props()

  // Board placement inside the stage. The player and filmstrip float over the bottom of the stage,
  // in a reserved band that's the same for images and videos, so the board never jumps.
  const MARGIN_X = 48
  const MARGIN_TOP = 40
  /** Matches the CSS: .player height, .film-row heights, and the gaps around them. */
  const RESERVED = 12 + 64 + 12 + 44 + 12 * 2
  const dpr = window.devicePixelRatio || 1

  const board = $derived(app.board)
  const settings = $derived(asset ? app.settingsOf(asset.name) : board.defaults)
  const placement = $derived(asset?.w ? computeLayout(board.width, board.height, asset.w, asset.h, settings) : null)

  let stage: HTMLDivElement
  let canvas: HTMLCanvasElement
  let width = $state(0)
  let height = $state(0)
  let cursor = $state('default')
  let readout = $state<{ x: number; y: number; text: string } | null>(null)
  // Another asset starts deselected.
  let selected = $derived.by(() => {
    void app.focus
    return false
  })
  let hovering = false
  let dragging = false
  let guides: Guides = NO_GUIDES

  // Framing: the board centred, zoomed out while selected just enough that the media's corners (so
  // the handles) are on screen. Held still while interacting, then eased to the new framing.
  let interacting = false
  let settled = $state(0)
  let held: View = { k: 1, bx: 0, by: 0 }
  const target = $derived.by((): View => {
    void settled
    if (interacting) return held
    const availW = width - MARGIN_X * 2
    const availH = height - MARGIN_TOP - RESERVED
    const fitK = Math.max(0.01, Math.min(availW / board.width, availH / board.height))
    let k = fitK
    if (placement && selected) {
      const b = bounds(placement)
      const ex = Math.max(board.width / 2, board.width / 2 - b.x, b.x + b.w - board.width / 2)
      const ey = Math.max(board.height / 2, board.height / 2 - b.y, b.y + b.h - board.height / 2)
      k = Math.max(fitK * 0.45, Math.min(fitK, availW / 2 / ex, availH / 2 / ey))
    }
    held = { k, bx: (width - board.width * k) / 2, by: MARGIN_TOP + (availH - board.height * k) / 2 }
    return held
  })
  const endInteraction = () => {
    interacting = false
    settled++
  }
  // Camera: Fit (the framing above, eased) or Manual, wherever you've scrolled, pinched or panned
  // to. A new asset goes back to Fit; in Manual, selecting no longer moves the view.
  let manual = $derived.by((): View | null => {
    void app.focus
    return null
  })
  // Resizing in Manual keeps the same point centred.
  let lastSize = { w: 0, h: 0 }
  $effect(() => {
    const w = width
    const h = height
    untrack(() => {
      if (manual && lastSize.w) manual = { k: manual.k, bx: manual.bx + (w - lastSize.w) / 2, by: manual.by + (h - lastSize.h) / 2 }
    })
    lastSize = { w, h }
  })
  const tk = $derived(target.k)
  const tbx = $derived(target.bx)
  const tby = $derived(target.by)
  const view = camera(
    () => ({ k: tk, bx: tbx, by: tby }),
    () => `${width}x${height}/${asset?.name}/${board.id}`,
    () => manual
  )
  const k = $derived(view.current.k)

  // Never draw the full-resolution source interactively (a 24MP photo stalls every frame). Draw a
  // copy sized to what's on screen instead, sharpened only when zooming in past it.
  let still = $state.raw<Blob | null>(null)
  // Another file (not the same one's thumbnail arriving) loads its own.
  const path = $derived(asset?.path)
  const mtime = $derived(asset?.mtime)
  const sw = $derived(asset?.w ?? 0)
  $effect(() => {
    still = null
    if (!path || !sw) return
    void mtime
    const a = untrack(() => asset!)
    let alive = true
    loadStill(a)
      .then((src) => alive && (still = src))
      .catch(() => {})
    return () => {
      alive = false
    }
  })
  const need = $derived(placement ? Math.max(placement.w, placement.h) * k * dpr : 0)
  const sourceSize = () => ({ w: asset?.w ?? 0, h: asset?.h ?? 0 })
  const stillBitmap = bitmapProxy(() => still, sourceSize, () => need, () => (asset?.thumb ? Math.max(asset.thumb.width, asset.thumb.height) : 0))
  const exactBitmap = bitmapProxy(() => player?.exact?.jpeg ?? null, sourceSize, () => need, () => 0)

  // Everything a frame is drawn from; the canvas redraws whenever it changes.
  const scene = $derived({
    asset,
    width,
    height,
    view: view.current,
    board,
    settings,
    still: stillBitmap.bitmap,
    exact: exactBitmap.bitmap,
    video: player?.video,
    playerFrame: player?.frame,
    picking: app.picking,
    selected
  })
  $effect(() => draw(scene))

  function draw(s = scene) {
    if (!canvas || !s.asset || !s.width) return
    const pw = Math.round(s.width * dpr)
    const ph = Math.round(s.height * dpr)
    const resized = canvas.width !== pw || canvas.height !== ph
    if (resized) {
      canvas.width = pw
      canvas.height = ph
    }
    const frame = player?.source(s.exact) ?? { source: null, hold: false }
    if (frame.hold && !resized) return
    drawStage(canvas.getContext('2d')!, {
      view: s.view,
      dpr,
      board: s.board,
      settings: s.settings,
      sw: s.asset.w,
      sh: s.asset.h,
      source: frame.source ?? s.still ?? s.asset.thumb,
      active: (s.selected || dragging) && !s.picking,
      dragging,
      hover: hovering && !s.picking,
      guides
    })
  }

  // Zoom transitions: the grid thumbnail flies up into the board on enter and back down on exit;
  // stepping between assets crossfades. While the flyer is in the air the canvas stays hidden.
  let entering = $state(false)
  let entered = false
  $effect(() => {
    if (entered || !width) return
    entered = true
    untrack(() => {
      if (!asset?.w) return
      const cell = document.querySelector<HTMLCanvasElement>(`.cell[data-name="${CSS.escape(asset.name)}"] canvas[data-ready]`)
      const host = stage.closest<HTMLElement>('.content')
      if (!cell || !host) return
      const s0 = stage.getBoundingClientRect()
      const to = new DOMRect(s0.left + target.bx, s0.top + target.by, board.width * target.k, board.height * target.k)
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
    void width
    void height
    stageRect = stage.getBoundingClientRect()
  })
  $effect(() => {
    // Hold on to the elements too: their references are cleared as the view is torn down.
    const c = canvas
    const host = stage.closest<HTMLElement>('.content')
    return () => {
      // Leaving: capture the board as drawn, then land it on its grid cell once the grid is back.
      const leaving = asset?.name
      const { k, bx, by } = view.current
      if (!leaving || !c.width || !host) return
      const w = board.width * k
      const h = board.height * k
      const from = new DOMRect(stageRect.left + bx, stageRect.top + by, w, h)
      const shot = snapshot(c, bx * dpr, by * dpr, w * dpr, h * dpr)
      requestAnimationFrame(() =>
        requestAnimationFrame(async () => {
          if (app.view !== 'grid') return
          const cell = document.querySelector<HTMLCanvasElement>(`.cell[data-name="${CSS.escape(leaving)}"] canvas`)
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
  // Stepping to another asset crossfades from what was on screen (before it's redrawn).
  let shown = untrack(() => asset?.name)
  $effect.pre(() => {
    const name = asset?.name
    if (shown && name !== shown && canvas) crossfade(canvas)
    shown = name
  })

  // Ends a gizmo drag still in progress if the view closes mid-drag.
  let endDrag: (() => void) | null = null
  $effect(() => () => endDrag?.())

  /** Client coordinates → artboard pixels. */
  function toBoard(clientX: number, clientY: number): Point {
    const r = stage.getBoundingClientRect()
    const v = view.current
    return { x: (clientX - r.left - v.bx) / v.k, y: (clientY - r.top - v.by) / v.k }
  }
  const hit = (pt: Point) => (placement ? hitTest(placement, board, pt, k, selected) : { mode: { kind: 'none' as const }, cursor: 'default' })

  // Camera moves, in stage pixels.
  const current = (): View => manual ?? view.current
  function zoomView(factor: number, sx: number, sy: number) {
    const v = current()
    const k1 = Math.min(40, Math.max(0.02, v.k * factor))
    manual = { k: k1, bx: sx - ((sx - v.bx) / v.k) * k1, by: sy - ((sy - v.by) / v.k) * k1 }
  }
  function panView(dx: number, dy: number) {
    const v = current()
    manual = { k: v.k, bx: v.bx + dx, by: v.by + dy }
  }
  const fitView = () => (manual = null)
  const actualPixels = () => zoomView(1 / dpr / current().k, width / 2, height / 2)

  // Trackpads: pinch zooms (Chromium reports it as a wheel with ctrlKey), two fingers pan. A mouse
  // wheel zooms. Mouse notches come in whole multiples of 120 with no sideways component; once a
  // gesture looks like a trackpad it stays one, so momentum never flips into zooming. Alt+scroll
  // scales the media itself.
  let trackpadUntil = 0
  let wheelIdle: ReturnType<typeof setTimeout> | undefined
  $effect(() => () => clearTimeout(wheelIdle))
  function onwheel(e: WheelEvent) {
    e.preventDefault()
    const r = stage.getBoundingClientRect()
    const sx = e.clientX - r.left
    const sy = e.clientY - r.top
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? r.height : 1
    const dx = e.deltaX * unit
    const dy = e.deltaY * unit
    const now = performance.now()
    if (e.altKey) {
      if (!asset?.w) return
      interacting = true
      clearTimeout(wheelIdle)
      wheelIdle = setTimeout(endInteraction, 500)
      const zoom = snapZoom(settings.zoom * Math.exp(-dy * 0.0015), true)
      app.editAsset(asset.name, zoomAbout(settings, board.width, board.height, asset.w, asset.h, zoom, toBoard(e.clientX, e.clientY)))
      return
    }
    const legacy = (e as WheelEvent & { wheelDeltaY?: number }).wheelDeltaY ?? 0
    const notch = e.deltaMode !== 0 || (e.deltaX === 0 && legacy !== 0 && legacy % 120 === 0)
    if (e.ctrlKey || e.metaKey) zoomView(Math.exp(-dy * (notch ? 0.0015 : 0.01)), sx, sy)
    else if (notch && now > trackpadUntil) zoomView(Math.exp(-dy * 0.0015), sx, sy)
    else {
      trackpadUntil = now + 300
      panView(-dx, -dy)
    }
  }

  // ⌘/Ctrl+0 fits; ⌘/Ctrl +/− zoom about the centre.
  function onkeydown(e: KeyboardEvent) {
    if (!(e.metaKey || e.ctrlKey) || (e.target as HTMLElement).closest?.('input, textarea')) return
    if (e.key === '0') fitView()
    else if (e.key === '=' || e.key === '+') zoomView(1.25, width / 2, height / 2)
    else if (e.key === '-') zoomView(0.8, width / 2, height / 2)
    else return
    e.preventDefault()
  }
  // Esc deselects first (in the capture phase, before the app-wide Esc goes back to the grid).
  function onkeydowncapture(e: KeyboardEvent) {
    if (!selected || e.key !== 'Escape' || app.picking || (e.target as HTMLElement).closest?.('input, textarea')) return
    e.preventDefault()
    e.stopImmediatePropagation()
    selected = false
  }

  /** Drags the view; a click that never moves calls `onClick` instead. */
  function startPan(e: PointerEvent, onClick?: () => void) {
    const el = e.currentTarget as HTMLElement
    el.setPointerCapture(e.pointerId)
    let last = { x: e.clientX, y: e.clientY }
    let moved = false
    const move = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 3) return
      if (!moved) cursor = 'grabbing'
      moved = true
      panView(ev.clientX - last.x, ev.clientY - last.y)
      last = { x: ev.clientX, y: ev.clientY }
    }
    const up = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      if (moved) cursor = 'default'
      else onClick?.()
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
  }

  function onpointermove(e: PointerEvent) {
    if (dragging) return
    const h = hit(toBoard(e.clientX, e.clientY))
    const over = h.mode.kind === 'move'
    if (over !== hovering) {
      hovering = over
      draw()
    }
    if (h.cursor !== cursor) cursor = h.cursor
  }

  function onpointerdown(e: PointerEvent) {
    // Middle button pans from anywhere.
    if (e.button === 1) {
      e.preventDefault()
      return startPan(e)
    }
    const a = asset
    if (e.button !== 0 || !a?.w) return
    const at = toBoard(e.clientX, e.clientY)
    const { mode } = hit(at)
    // Empty space: drag to pan, click to deselect.
    if (mode.kind === 'none') return startPan(e, () => (selected = false))
    // Editing defaults (the asset is on screen but not selected): clicking it selects it again.
    if (!app.selected.has(a.name)) app.setSelection([a.name])
    const el = e.currentTarget as HTMLElement
    el.setPointerCapture(e.pointerId)
    selected = true
    const start: DragStart = { mode, start: settings, board, sw: a.w, sh: a.h, k, at }
    const stageRect = stage.getBoundingClientRect()
    dragging = true
    interacting = true

    let last: Pick<PointerEvent, 'clientX' | 'clientY'> = e
    const apply = (clientX: number, clientY: number, mods: { shiftKey: boolean; altKey: boolean; metaKey: boolean; ctrlKey: boolean }) => {
      last = { clientX, clientY }
      const r = dragTo(start, toBoard(clientX, clientY), { shift: mods.shiftKey, alt: mods.altKey, mod: mods.metaKey || mods.ctrlKey })
      guides = r.guides
      readout = r.readout ? { x: clientX - stageRect.left + 16, y: clientY - stageRect.top + 16, text: r.readout } : null
      app.editAsset(a.name, r.patch)
    }
    const move = (ev: PointerEvent) => apply(ev.clientX, ev.clientY, ev)
    // Pressing or releasing a modifier re-applies the whole drag at once, without waiting for the
    // pointer to move.
    const modifiers = (ke: KeyboardEvent) => {
      if (!['Shift', 'Alt', 'Control', 'Meta'].includes(ke.key)) return
      ke.preventDefault()
      apply(last.clientX, last.clientY, ke)
      draw()
    }
    const up = () => {
      endDrag = null
      dragging = false
      endInteraction()
      guides = NO_GUIDES
      readout = null
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      window.removeEventListener('keydown', modifiers, true)
      window.removeEventListener('keyup', modifiers, true)
      draw()
    }
    endDrag = up
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
    window.addEventListener('keydown', modifiers, true)
    window.addEventListener('keyup', modifiers, true)
    draw()
  }

  // Double-click the media to reset its transform; double-click empty space to go back to the grid.
  function ondblclick(e: MouseEvent) {
    if (hit(toBoard(e.clientX, e.clientY)).mode.kind === 'none') app.setView('grid')
    else if (asset) app.resetKeys(['zoom', 'scaleX', 'scaleY', 'offsetX', 'offsetY', 'rotation'], [asset.name])
  }
</script>

<svelte:window {onkeydown} {onkeydowncapture} />

<div
  class="stage"
  role="presentation"
  bind:this={stage}
  bind:clientWidth={width}
  bind:clientHeight={height}
  style:cursor
  {onwheel}
  {onpointerdown}
  {onpointermove}
  onpointerleave={() => {
    hovering = false
    draw()
  }}
  {ondblclick}
  oncontextmenu={(e) => {
    e.preventDefault()
    if (asset) assetMenu(asset.name, asset.path, { x: e.clientX, y: e.clientY }, true)
  }}
>
  <canvas bind:this={canvas} style:width={`${width}px`} style:height={`${height}px`} style:opacity={entering ? 0 : 1}></canvas>
  {#if asset}
    <button
      class="zoom-chip"
      title={manual ? `Fit to view (${combo(MOD, '0')})` : 'Actual pixels'}
      onpointerdown={(e) => e.stopPropagation()}
      onclick={() => (manual ? fitView() : actualPixels())}
    >
      {manual ? `${Math.round(k * dpr * 100)}%` : 'Fit'}
    </button>
  {/if}
  {#if readout}<div class="readout" style:left={`${readout.x}px`} style:top={`${readout.y}px`}>{readout.text}</div>{/if}
  {#if !app.focus}<div class="empty-hint">Nothing selected</div>{/if}
</div>
