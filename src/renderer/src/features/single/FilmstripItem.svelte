<script lang="ts">
  import { drawLayout } from '@shared/arrangement'
  import { drawFrame, resolveSettings } from '@shared/layout'
  import type { Artboard } from '@shared/types'
  import { visibility } from '../../lib/attach'
  import { scheduleDraw } from '../../lib/draw-queue'
  import type { Asset } from '../../state/library.svelte'
  import { thumbSource, type LayoutScene } from '../scene'
  import { FILM_HEIGHT } from './film'

  let {
    asset,
    board,
    scene,
    on,
    onclick,
    onSeen
  }: {
    asset: Asset
    board: Artboard
    /** A layout, as it sits on the board. */
    scene: LayoutScene | null
    /** The one the single view shows. */
    on: boolean
    onclick: () => void
    /** On screen with nothing loaded yet. */
    onSeen: () => void
  } = $props()
  const settings = $derived(resolveSettings(board, asset.name))
  const width = $derived(Math.round((FILM_HEIGHT * board.width) / board.height))
  const dpr = window.devicePixelRatio || 1
  const key = $derived(
    `${JSON.stringify(settings)}|${width}x${FILM_HEIGHT}@${dpr}|${asset.w}x${asset.h}|${asset.mtime}|${!!asset.thumb}@${asset.thumbAt}|${scene?.stamp}`
  )

  let canvas: HTMLCanvasElement
  let ready = $state(false)
  let visible = $state(false)
  let drawn = ''

  function draw() {
    if (!canvas || (!asset.thumb && !scene)) return
    const pw = Math.round(width * dpr)
    const ph = Math.round(FILM_HEIGHT * dpr)
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw
      canvas.height = ph
    }
    const ctx = canvas.getContext('2d')!
    if (scene) drawLayout(ctx, scene.layout, scene.arrangement, board.width, board.height, pw / board.width, thumbSource(scene))
    else drawFrame(ctx, asset.thumb, asset.w, asset.h, board.width, board.height, settings, pw / board.width)
    ready = true
    drawn = key
  }
  const task = () => draw()
  $effect(() => {
    if (visible && drawn !== key) scheduleDraw(task)
  })
  const onVisible = (v: boolean) => {
    visible = v
    if (v && !asset.thumb && !scene) onSeen()
  }
</script>

<button tabindex={-1} class={['film-item', { on, skipped: settings.skip }]} title={asset.label} {onclick}>
  <canvas bind:this={canvas} data-ready={ready || undefined} {@attach visibility(onVisible)} style:width={`${width}px`} style:height={`${FILM_HEIGHT}px`}
  ></canvas>
</button>

<style>
  /* Thumbnails are draggable too, so they keep the strip's grab cursor. */
  .film-item {
    position: relative;
    flex: none;
    padding: 3px;
    border-radius: 7px;
    cursor: inherit;
  }

  .film-item:hover {
    background: var(--tint-1);
  }

  .film-item.on {
    background: var(--tint-3);
  }

  canvas {
    display: block;
    border-radius: 3px;
    background: var(--panel);
    opacity: 0;
    transition: opacity 260ms var(--ease);
  }

  canvas[data-ready] {
    opacity: 1;
  }

  .skipped canvas[data-ready] {
    opacity: 0.3;
  }

  /* Excluded from export: a faint X just over the image, inside the item's padding. */
  .skipped::after {
    content: '';
    position: absolute;
    inset: 3px;
    background: var(--excluded-x) no-repeat center / 100% 100%;
    pointer-events: none;
  }
</style>
