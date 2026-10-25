<!-- Numeric input that commits on enter/blur, steps with arrow keys, and scrubs by dragging its label. -->
<script lang="ts">
  import { middleReset } from '../lib/format'

  let {
    value,
    onChange,
    onReset,
    label,
    step = 1,
    min = -Infinity,
    max = Infinity,
    suffix,
    width
  }: {
    value: number
    onChange: (v: number) => void
    /** Middle-click: back to the default. */
    onReset?: () => void
    label?: string
    step?: number
    min?: number
    max?: number
    suffix?: string
    width?: number
  } = $props()

  const round = (v: number, step: number) => {
    const d = Math.max(0, -Math.floor(Math.log10(step)))
    return Number(v.toFixed(d))
  }
  let draft = $state<string | null>(null)
  const clampv = (v: number) => Math.min(max, Math.max(min, round(v, step)))
  const commit = () => {
    if (draft == null) return
    const v = parseFloat(draft)
    if (Number.isFinite(v)) onChange(clampv(v))
    draft = null
  }
  const scrub = (e: PointerEvent) => {
    if (e.button !== 0) return
    const startX = e.clientX
    const start = value
    const el = e.currentTarget as HTMLElement
    el.setPointerCapture(e.pointerId)
    const move = (ev: PointerEvent) => onChange(clampv(start + (ev.clientX - startX) * step * (ev.shiftKey ? 10 : 1)))
    const up = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
  }
  const onkeydown = (e: KeyboardEvent) => {
    const input = e.target as HTMLInputElement
    if (e.key === 'Enter') input.blur()
    if (e.key === 'Escape') {
      draft = null
      input.blur()
    }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault()
      draft = null
      onChange(clampv(value + (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1)))
    }
  }
</script>

<label class="num" style={width ? `width: ${width}px` : undefined} {...middleReset(onReset && (() => ((draft = null), onReset())))}>
  {#if label}<span class="num-label" role="presentation" onpointerdown={scrub}>{label}</span>{/if}
  <input
    value={draft ?? String(round(value, step))}
    oninput={(e) => (draft = e.currentTarget.value)}
    onblur={commit}
    onfocus={(e) => e.currentTarget.select()}
    {onkeydown}
  />
  {#if suffix}<span class="num-suffix">{suffix}</span>{/if}
</label>
