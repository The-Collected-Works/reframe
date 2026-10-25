<script lang="ts">
  import { middleReset } from '../lib/format'

  let {
    value,
    min,
    max,
    step,
    onChange,
    curve = 1,
    onReset,
    width,
    bright = false,
    title
  }: {
    value: number
    min: number
    max: number
    step: number
    onChange: (v: number) => void
    /** >1 gives more resolution at the low end. */
    curve?: number
    onReset?: () => void
    /** Fixed width (px); otherwise it takes the room it's given. */
    width?: number
    /** Over media: a thicker, white track. */
    bright?: boolean
    title?: string
  } = $props()

  const toPos = (v: number) => Math.pow((v - min) / (max - min), 1 / curve)
  const fromPos = (p: number) => min + Math.pow(p, curve) * (max - min)
  const pos = $derived(Math.min(1, Math.max(0, toPos(value))))
</script>

<input
  type="range"
  class={['slider', { bright, fixed: width }]}
  {title}
  min={0}
  max={1000}
  value={Math.round(pos * 1000)}
  style:--p={`${pos * 100}%`}
  style:width={width ? `${width}px` : undefined}
  {...middleReset(onReset)}
  oninput={(e) => onChange(Math.round(fromPos(Number(e.currentTarget.value) / 1000) / step) * step)}
/>

<style>
  .slider {
    -webkit-appearance: none;
    appearance: none;
    flex: 1;
    height: 20px;
    margin: 0;
    background: transparent;
    min-width: 0;
  }

  .slider.fixed {
    flex: none;
  }

  .slider::-webkit-slider-runnable-track {
    height: 3px;
    border-radius: 2px;
    background: linear-gradient(to right, var(--muted) var(--p), var(--line-strong) var(--p));
  }

  .slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 12px;
    height: 12px;
    margin-top: -4.5px;
    border-radius: 50%;
    background: var(--text);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.5);
  }

  .slider:hover::-webkit-slider-thumb {
    transform: scale(1.15);
  }

  .bright::-webkit-slider-runnable-track {
    height: 4px;
    background: linear-gradient(to right, var(--text) var(--p), rgba(255, 255, 255, 0.16) var(--p));
  }

  .bright::-webkit-slider-thumb {
    margin-top: -4px;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.45);
    transition: transform var(--t-fast) var(--ease);
  }
</style>
