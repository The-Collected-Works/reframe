<script lang="ts">
  import { middleReset } from '../format'

  let {
    value,
    min,
    max,
    step,
    onChange,
    curve = 1,
    onReset
  }: {
    value: number
    min: number
    max: number
    step: number
    onChange: (v: number) => void
    /** >1 gives more resolution at the low end. */
    curve?: number
    onReset?: () => void
  } = $props()

  const toPos = (v: number) => Math.pow((v - min) / (max - min), 1 / curve)
  const fromPos = (p: number) => min + Math.pow(p, curve) * (max - min)
  const pos = $derived(Math.min(1, Math.max(0, toPos(value))))
</script>

<input
  type="range"
  class="slider"
  min={0}
  max={1000}
  value={Math.round(pos * 1000)}
  style:--p={`${pos * 100}%`}
  {...middleReset(onReset)}
  oninput={(e) => onChange(Math.round(fromPos(Number(e.currentTarget.value) / 1000) / step) * step)}
/>
