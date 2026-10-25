<script lang="ts">
  import { drawFrame, resolveSettings } from '@shared/layout'
  import type { Artboard, AssetEntry } from '@shared/types'
  import { observeVisibility, scheduleDraw } from '../lazydraw'
  import { prioritize } from '../media'
  import { app, withMeta } from '../store.svelte'
  import { FILM_HEIGHT } from './film'

  let { entry, board, on }: { entry: AssetEntry; board: Artboard; on: boolean } = $props()

  const asset = $derived(withMeta(entry, app.meta.get(entry.name)))
  const settings = $derived(resolveSettings(board, entry.name))
  const width = $derived(Math.round((FILM_HEIGHT * board.width) / board.height))
  const dpr = window.devicePixelRatio || 1
  const key = $derived(`${JSON.stringify(settings)}|${width}x${FILM_HEIGHT}@${dpr}|${asset.w}x${asset.h}|${asset.mtime}|${!!asset.thumb}`)

  let canvas: HTMLCanvasElement
  let visible = false
  let drawn = ''

  function draw() {
    if (!canvas || !asset.thumb) return
    const pw = Math.round(width * dpr)
    const ph = Math.round(FILM_HEIGHT * dpr)
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw
      canvas.height = ph
    }
    drawFrame(canvas.getContext('2d')!, asset.thumb, asset.w, asset.h, board.width, board.height, settings, pw / board.width)
    canvas.dataset.ready = '1'
    drawn = key
  }
  const task = () => draw()
  function request() {
    if (visible && drawn !== key) scheduleDraw(task)
  }
  $effect(() => {
    void key
    request()
  })
  $effect(() =>
    observeVisibility(canvas, (v) => {
      visible = v
      if (v && !asset.thumb) prioritize(asset.path)
      request()
    })
  )
</script>

<button tabindex={-1} class={'film-item' + (on ? ' on' : '') + (settings.skip ? ' skipped' : '')} title={entry.name} onclick={() => app.select(entry.name)}>
  <canvas bind:this={canvas} style:width={`${width}px`} style:height={`${FILM_HEIGHT}px`}></canvas>
</button>
