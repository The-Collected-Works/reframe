<script lang="ts">
  import { fmtTime } from '../../lib/format'

  let {
    duration,
    start,
    end,
    time,
    aspect,
    onScrubStart,
    onSeek,
    onScrubEnd,
    onPreview,
    onTrim,
    onTrimEnd
  }: {
    duration: number
    start: number
    end: number
    time: number
    aspect: number
    onScrubStart: () => void
    onSeek: (t: number) => void
    onScrubEnd: (t: number) => void
    onPreview: (canvas: HTMLCanvasElement, t: number) => void
    onTrim: (start: number, end: number) => void
    onTrimEnd: (start: number, end: number) => void
  } = $props()

  let body: HTMLDivElement
  let canvas = $state<HTMLCanvasElement>()
  let scrub = $state<number | null>(null)
  let hover = $state<number | null>(null)
  let active = $state<'seek' | 'in' | 'out' | null>(null)
  // Preview box: the artboard's shape, about 150px on its long side.
  const pw = $derived(Math.round(aspect >= 1 ? 150 : 150 * aspect))
  const ph = $derived(Math.round(aspect >= 1 ? 150 / aspect : 150))
  const dpr = window.devicePixelRatio || 1
  $effect(() => {
    if (scrub != null && canvas) onPreview(canvas, scrub)
  })
  const pct = (t: number) => `${(t / duration) * 100}%`
  const at = (clientX: number) => {
    const r = body.getBoundingClientRect()
    return Math.min(duration, Math.max(0, ((clientX - r.left) / r.width) * duration))
  }
  function drag(e: PointerEvent, kind: 'seek' | 'in' | 'out') {
    if (e.button !== 0) return
    e.stopPropagation()
    const el = e.currentTarget as HTMLElement
    el.setPointerCapture(e.pointerId)
    active = kind
    if (kind === 'seek') onScrubStart()
    let range = { start, end }
    let seekTo = time
    const apply = (x: number) => {
      const t = at(x)
      if (kind === 'seek') {
        seekTo = Math.min(end, Math.max(start, t))
        hover = seekTo
        return onSeek(seekTo)
      }
      if (kind === 'in') {
        range = { start: Math.max(0, Math.min(t, end - 0.1)), end }
        scrub = range.start
      } else {
        range = { start, end: Math.min(duration, Math.max(t, start + 0.1)) }
        // Last frame that's kept.
        scrub = Math.max(range.start, range.end - 0.04)
      }
      onTrim(range.start, range.end)
    }
    apply(e.clientX)
    const move = (ev: PointerEvent) => apply(ev.clientX)
    const up = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      active = null
      if (kind === 'seek') return onScrubEnd(seekTo)
      scrub = null
      onTrimEnd(range.start, range.end)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
  }
  // The hover bubble shows where a click would seek to (clamped to the kept range).
  const bubble = $derived(active === 'in' || active === 'out' ? null : hover)
</script>

<div
  class={['timeline', { active }]}
  role="presentation"
  onpointerdown={(e) => drag(e, 'seek')}
  onpointermove={(e) => !active && (hover = Math.min(end, Math.max(start, at(e.clientX))))}
  onpointerleave={() => !active && (hover = null)}
>
  <div class="tl-body" bind:this={body}>
    <div class="tl-rail">
      <div class="tl-range" style:left={pct(start)} style:width={pct(end - start)}></div>
      <div class="tl-played" style:left={pct(start)} style:width={pct(Math.max(0, time - start))}></div>
    </div>
    <div class="tl-head" style:left={pct(time)}></div>
    <div class={['tl-handle in', { on: active === 'in' }]} style:left={pct(start)} role="presentation" onpointerdown={(e) => drag(e, 'in')} title="Trim start"></div>
    <div class={['tl-handle out', { on: active === 'out' }]} style:left={pct(end)} role="presentation" onpointerdown={(e) => drag(e, 'out')} title="Trim end"></div>
    {#if bubble != null}
      <div class="tl-bubble" style:left={pct(bubble)}>{fmtTime(Math.max(0, bubble - start))}</div>
    {/if}
    {#if scrub != null}
      <div class="tl-preview" style:left={pct(scrub)}>
        <canvas bind:this={canvas} width={Math.round(pw * dpr)} height={Math.round(ph * dpr)} style:width={`${pw}px`} style:height={`${ph}px`}></canvas>
        <span>{fmtTime(scrub)}</span>
      </div>
    {/if}
  </div>
</div>
