<!--
  An inline colour picker: saturation and brightness in the square, hue in the strip below, and the
  hex field (with anything passed as children beside it, an eyedropper say). Drag either, or focus
  one and use the arrow keys (Shift for bigger steps).
-->
<script lang="ts">
  import type { Snippet } from 'svelte'
  import { untrack } from 'svelte'
  import { trackPointer } from '../../lib/drag'
  import ColorField from './ColorField.svelte'
  import { toHex, toHsv, type Hsv } from './color'

  let { value, onChange, onReset, children }: { value: string; onChange: (v: string) => void; onReset?: () => void; children?: Snippet } = $props()

  // Kept apart from the hex: a grey has no hue and black no saturation, so taking them from the hex
  // alone would make the handles jump as they pass through those.
  let hsv = $state<Hsv>(toHsv(untrack(() => value)))
  $effect.pre(() => {
    const v = value
    untrack(() => {
      if (toHex(hsv) === v) return
      const next = toHsv(v)
      hsv = { h: next.s && next.v ? next.h : hsv.h, s: next.v ? next.s : hsv.s, v: next.v }
    })
  })

  const clamp = (n: number) => Math.min(1, Math.max(0, n))
  function set(patch: Partial<Hsv>) {
    hsv = { ...hsv, ...patch }
    const hex = toHex(hsv)
    if (hex !== value) onChange(hex)
  }

  /** The hue thumb's radius: it travels inside the strip, so it never hangs off the panel's edge. */
  const INSET = 7

  /**
   * Follows a drag from a press (which sets it too), reporting where the pointer is in the element,
   * 0–1, `inset` pixels in from each side.
   */
  function drag(e: PointerEvent, to: (x: number, y: number) => void, inset = 0) {
    if (e.button !== 0) return
    const el = e.currentTarget as HTMLElement
    el.focus()
    const at = (ev: PointerEvent) => {
      const r = el.getBoundingClientRect()
      to(clamp((ev.clientX - r.left - inset) / (r.width - inset * 2)), clamp((ev.clientY - r.top) / r.height))
    }
    at(e)
    trackPointer(e, { move: at })
  }

  const STEPS: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }
  function svKeys(e: KeyboardEvent) {
    const d = STEPS[e.key]
    if (!d) return
    e.preventDefault()
    const k = e.shiftKey ? 0.1 : 0.01
    set({ s: clamp(hsv.s + d[0] * k), v: clamp(hsv.v + d[1] * k) })
  }
  function hueKeys(e: KeyboardEvent) {
    const d = STEPS[e.key]
    if (!d) return
    e.preventDefault()
    set({ h: Math.min(360, Math.max(0, hsv.h + (d[0] || d[1]) * (e.shiftKey ? 10 : 1))) })
  }
</script>

<div class="picker">
  <div
    class="sv"
    role="slider"
    tabindex="0"
    aria-label="Saturation and brightness"
    aria-valuetext={`${Math.round(hsv.s * 100)}% saturation, ${Math.round(hsv.v * 100)}% brightness`}
    aria-valuenow={Math.round(hsv.v * 100)}
    style:--hue={`hsl(${hsv.h} 100% 50%)`}
    onpointerdown={(e) => drag(e, (x, y) => set({ s: x, v: 1 - y }))}
    onkeydown={svKeys}
  >
    <span class="thumb" style:left={`${hsv.s * 100}%`} style:top={`${(1 - hsv.v) * 100}%`} style:background={value}></span>
  </div>
  <div
    class="hue"
    role="slider"
    tabindex="0"
    aria-label="Hue"
    aria-valuemin={0}
    aria-valuemax={360}
    aria-valuenow={Math.round(hsv.h)}
    onpointerdown={(e) => drag(e, (x) => set({ h: x * 360 }), INSET)}
    onkeydown={hueKeys}
  >
    <span class="thumb" style:left={`calc(${INSET}px + ${hsv.h / 360} * (100% - ${INSET * 2}px))`} style:background={`hsl(${hsv.h} 100% 50%)`}></span>
  </div>
  <div class="row">
    <ColorField {value} {onChange} {onReset} />
    {@render children?.()}
  </div>
</div>

<style>
  .picker {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .sv,
  .hue {
    position: relative;
    outline: 0;
    touch-action: none;
    cursor: crosshair;
  }

  .sv {
    height: 120px;
    border-radius: 6px;
    background: linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, var(--hue));
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08);
  }

  .hue {
    height: 10px;
    border-radius: 5px;
    background: linear-gradient(to right, #f00, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00);
  }

  .thumb {
    position: absolute;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    transform: translate(-50%, -50%);
    box-shadow:
      0 0 0 2px #fff,
      0 0 0 3px rgba(0, 0, 0, 0.35),
      0 1px 4px rgba(0, 0, 0, 0.4);
    pointer-events: none;
  }

  .hue .thumb {
    top: 50%;
  }

  /* Keyboard focus: the thumb grows a ring. */
  :global(.keyboard-nav) .sv:focus-visible .thumb,
  :global(.keyboard-nav) .hue:focus-visible .thumb {
    box-shadow:
      0 0 0 2px #fff,
      0 0 0 4px var(--accent);
  }

  .row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
</style>
