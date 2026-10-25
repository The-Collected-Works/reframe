<!--
  An eyedropper over the window, sampling what the app drew into canvases marked `data-eyedropper`.
  It reads those pixels directly rather than capturing the screen, so it opens at once and gives the
  values that were drawn (no display colour profile applied on the way). A magnifier follows the
  pointer; a click on a canvas picks, a click anywhere else, Esc or I cancels.
-->
<script module lang="ts">
  // Where the pointer is, so the magnifier shows at once when it opens from the keyboard.
  let last: { x: number; y: number } | null = null
  window.addEventListener('pointermove', (e) => (last = { x: e.clientX, y: e.clientY }), { capture: true, passive: true })
</script>

<script lang="ts">
  import { onMount } from 'svelte'

  let { onPick, onCancel }: { onPick: (hex: string) => void; onCancel: () => void } = $props()

  /** Pixels either side of the one sampled, and how large each shows. */
  const R = 5
  const N = R * 2 + 1
  const ZOOM = 10
  const SIZE = N * ZOOM
  /** A canvas can change under the pointer (a paused video's exact frame landing): re-read it this often. */
  const STALE = 150

  let zoomed: HTMLCanvasElement
  let at = $state<{ x: number; y: number } | null>(null)
  let hex = $state<string | null>(null)
  let over = $state(false)

  // Read back once into a CPU copy, so sampling never slows the canvas's own drawing.
  const copies = new Map<HTMLCanvasElement, { ctx: OffscreenCanvasRenderingContext2D; t: number }>()
  function pixels(c: HTMLCanvasElement) {
    let copy = copies.get(c)
    const now = performance.now()
    if (!copy || copy.ctx.canvas.width !== c.width || copy.ctx.canvas.height !== c.height || now - copy.t > STALE) {
      const ctx = new OffscreenCanvas(c.width, c.height).getContext('2d', { willReadFrequently: true })!
      ctx.drawImage(c, 0, 0)
      copies.set(c, (copy = { ctx, t: now }))
    }
    return copy.ctx
  }

  function sample(x: number, y: number) {
    at = { x, y }
    const c = document.elementsFromPoint(x, y).find((n): n is HTMLCanvasElement => n instanceof HTMLCanvasElement && 'eyedropper' in n.dataset)
    over = !!c && c.width > 0
    if (!c || !over) return void (hex = null)
    const r = c.getBoundingClientRect()
    const px = Math.floor(((x - r.left) * c.width) / r.width)
    const py = Math.floor(((y - r.top) * c.height) / r.height)
    const img = pixels(c).getImageData(px - R, py - R, N, N)
    zoomed.getContext('2d')!.putImageData(img, 0, 0)
    const d = img.data
    const i = (R * N + R) * 4
    // Only solid pixels: outside the artboard in the single view is see-through, not media.
    hex = d[i + 3] === 255 ? '#' + [d[i], d[i + 1], d[i + 2]].map((v) => v.toString(16).padStart(2, '0')).join('') : null
  }

  onMount(() => {
    if (last) sample(last.x, last.y)
  })

  function onpointerdown(e: PointerEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (e.button === 0 && hex) onPick(hex)
    else onCancel()
  }

  // Modal while open: every key stops here.
  function onkeydowncapture(e: KeyboardEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (e.key === 'Escape' || e.key.toLowerCase() === 'i') onCancel()
  }

  // Beside the pointer, flipping to the other side near the window's edges.
  const GAP = 18
  const left = $derived(at ? (at.x + GAP + SIZE > window.innerWidth ? at.x - GAP - SIZE : at.x + GAP) : 0)
  const H = SIZE + 34
  const top = $derived(at ? (at.y + GAP + H > window.innerHeight ? at.y - GAP - H : at.y + GAP) : 0)
</script>

<svelte:window {onkeydowncapture} onblur={onCancel} />

<div class="eyedropper" role="presentation" {onpointerdown} onpointermove={(e) => sample(e.clientX, e.clientY)} oncontextmenu={(e) => e.preventDefault()}>
  <div class={['magnifier', { hidden: !over }]} style:left={`${left}px`} style:top={`${top}px`}>
    <div class="zoom">
      <canvas bind:this={zoomed} width={N} height={N} style:width={`${SIZE}px`} style:height={`${SIZE}px`}></canvas>
      <span class="target" style:left={`${R * ZOOM}px`} style:top={`${R * ZOOM}px`} style:width={`${ZOOM}px`} style:height={`${ZOOM}px`}></span>
    </div>
    <div class="readout">
      <span class="swatch" style:background={hex ?? 'transparent'}></span>
      <span class="tabular">{hex ? hex.slice(1) : '—'}</span>
    </div>
  </div>
</div>

<style>
  .eyedropper {
    position: fixed;
    inset: 0;
    z-index: 200;
    cursor: crosshair;
  }

  .magnifier {
    position: fixed;
    pointer-events: none;
    padding: 4px;
    border-radius: 12px;
    background: var(--raised);
    box-shadow:
      0 0 0 1px var(--line-strong),
      0 8px 24px rgba(0, 0, 0, 0.5);
  }

  .magnifier.hidden {
    visibility: hidden;
  }

  .zoom {
    position: relative;
    overflow: hidden;
    border-radius: 8px;
    background: var(--well);
  }

  canvas {
    display: block;
    image-rendering: pixelated;
  }

  /* The sampled pixel: white inside black, so it shows on any colour. */
  .target {
    position: absolute;
    box-shadow:
      0 0 0 1px #fff,
      0 0 0 2px #000;
  }

  .readout {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 26px;
    padding: 0 4px;
    font-size: 11px;
  }

  .swatch {
    width: 12px;
    height: 12px;
    border-radius: 3px;
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.2);
  }
</style>
