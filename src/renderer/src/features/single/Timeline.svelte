<script module lang="ts">
  /** A video's trim: its handles, and the frame under each as it's dragged. */
  export interface Trim {
    start: number
    end: number
    /** The artboard's, for the previews. */
    aspect: number
    /** Draws the frame at `t` into a handle's preview. */
    onPreview: (canvas: HTMLCanvasElement, t: number) => void
    onTrim: (start: number, end: number) => void
    onTrimEnd: (start: number, end: number) => void
  }
</script>

<script lang="ts">
  import { trackPointer } from '../../lib/drag'
  import { fmtTime } from '../../lib/format'

  let {
    duration,
    time,
    trim,
    onScrubStart,
    onSeek,
    onScrubEnd,
    cached = duration
  }: {
    duration: number
    time: number
    /** Without one, all of it plays (a composition, say) and there are no handles. */
    trim?: Trim
    onScrubStart: () => void
    onSeek: (t: number) => void
    onScrubEnd: (t: number) => void
    /** How far it plays smoothly (seconds): its playback copies, as far as they're made so far. */
    cached?: number
  } = $props()

  const start = $derived(trim?.start ?? 0)
  const end = $derived(trim?.end ?? duration)
  const aspect = $derived(trim?.aspect ?? 1)

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
    if (scrub != null && canvas) trim?.onPreview(canvas, scrub)
  })
  const pct = (t: number) => `${(t / duration) * 100}%`
  const at = (clientX: number) => {
    const r = body.getBoundingClientRect()
    return Math.min(duration, Math.max(0, ((clientX - r.left) / r.width) * duration))
  }
  function drag(e: PointerEvent, kind: 'seek' | 'in' | 'out') {
    if (e.button !== 0) return
    e.stopPropagation()
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
      trim?.onTrim(range.start, range.end)
    }
    apply(e.clientX)
    trackPointer(e, {
      move: (ev) => apply(ev.clientX),
      end: () => {
        active = null
        if (kind === 'seek') return onScrubEnd(seekTo)
        scrub = null
        trim?.onTrimEnd(range.start, range.end)
      }
    })
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
      <!-- The cache line, as in After Effects: what's ready to play smoothly, on the rail under
           what's played. It fills as the copy is made, then fades once all of it is. -->
      <div class={['tl-cached', { full: cached >= duration - 0.05 }]} style:width={pct(Math.min(cached, duration))}></div>
      <div class="tl-played" style:left={pct(start)} style:width={pct(Math.max(0, time - start))}></div>
    </div>
    <div class="tl-head" style:left={pct(time)}></div>
    {#if trim}<div
        class={['tl-handle in', { on: active === 'in' }]}
        style:left={pct(start)}
        role="presentation"
        onpointerdown={(e) => drag(e, 'in')}
        title="Trim start"
      ></div>
      <div
        class={['tl-handle out', { on: active === 'out' }]}
        style:left={pct(end)}
        role="presentation"
        onpointerdown={(e) => drag(e, 'out')}
        title="Trim end"
      ></div>{/if}
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

<style>
  /* The hit area is the full bar height; the rail inside is slim. The body is inset so the trim
     grips, which sit just outside the kept range, never clip. */
  .timeline {
    flex: 1;
    min-width: 0;
    height: 44px;
    padding: 0 10px;
    display: flex;
  }

  .tl-body {
    position: relative;
    flex: 1;
  }

  .tl-rail {
    position: absolute;
    left: 0;
    right: 0;
    top: 50%;
    height: 4px;
    margin-top: -2px;
    border-radius: 2px;
    background: rgba(255, 255, 255, 0.07);
  }

  .tl-range,
  .tl-played {
    position: absolute;
    top: 0;
    bottom: 0;
    border-radius: inherit;
  }

  .tl-range {
    background: rgba(255, 255, 255, 0.2);
  }

  .tl-played {
    background: var(--text);
  }

  .tl-cached {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    border-radius: inherit;
    background: color-mix(in srgb, var(--cached) 70%, transparent);
    pointer-events: none;
    transition:
      width 250ms linear,
      opacity 600ms var(--ease) 400ms;
  }

  .tl-cached.full {
    opacity: 0;
  }

  /* Playhead: a slim bar, slim enough to sit beside the trim grips. */
  .tl-head {
    position: absolute;
    top: 50%;
    width: 3px;
    height: 14px;
    margin: -7px 0 0 -1.5px;
    border-radius: 1.5px;
    background: #fff;
    box-shadow:
      0 0 0 0.5px rgba(0, 0, 0, 0.25),
      0 1px 4px rgba(0, 0, 0, 0.5);
    pointer-events: none;
  }

  /* Trim grips: quiet slivers just outside the kept range, brighter when the bar is in use. */
  .tl-handle {
    position: absolute;
    top: 50%;
    width: 3px;
    height: 12px;
    margin-top: -6px;
    border-radius: 1.5px;
    background: rgba(255, 255, 255, 0.32);
    cursor: ew-resize;
    transition:
      background-color var(--t-fast) var(--ease),
      height 160ms var(--ease),
      margin-top 160ms var(--ease);
  }

  .tl-handle.in {
    margin-left: -6px;
  }

  .tl-handle.out {
    margin-left: 3px;
  }

  /* A larger, invisible grab area. */
  .tl-handle::before {
    content: '';
    position: absolute;
    inset: -12px -7px;
  }

  .timeline:hover .tl-handle,
  .timeline.active .tl-handle {
    background: rgba(255, 255, 255, 0.6);
  }

  .timeline .tl-handle:hover,
  .timeline .tl-handle.on {
    height: 16px;
    margin-top: -8px;
    background: #fff;
  }

  /* Time under the pointer. */
  .tl-bubble {
    position: absolute;
    bottom: calc(50% + 14px);
    translate: -50% 0;
    padding: 3px 7px;
    border-radius: 6px;
    background: var(--raised);
    box-shadow:
      0 0 0 1px var(--line-strong),
      0 4px 14px rgba(0, 0, 0, 0.4);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    color: var(--text);
    white-space: nowrap;
    pointer-events: none;
    animation: fade 120ms var(--ease) both;
  }

  /* The frame at a trim handle while it's dragged. */
  .tl-preview {
    position: absolute;
    bottom: calc(50% + 18px);
    translate: -50% 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 5px;
    padding: 4px 4px 5px;
    border-radius: 8px;
    background: var(--raised);
    box-shadow:
      0 0 0 1px var(--line-strong),
      0 8px 28px rgba(0, 0, 0, 0.5);
    pointer-events: none;
    z-index: 3;
    transform-origin: bottom center;
    animation: preview-in 180ms var(--spring) both;
  }

  @keyframes preview-in {
    from {
      opacity: 0;
      transform: translateY(6px) scale(0.94);
    }
  }

  .tl-preview canvas {
    display: block;
    border-radius: 4px;
    background: var(--well);
  }

  .tl-preview span {
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    color: var(--text);
  }
</style>
