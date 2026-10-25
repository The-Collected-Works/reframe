<!-- Play / pause, the time, the timeline with its trim handles, the trimmed length and the volume. -->
<script lang="ts">
  import { fmtTime } from '../../lib/format'
  import type { Asset } from '../../state/app.svelte'
  import Icon from '../../ui/Icon.svelte'
  import type { Player } from './player.svelte'
  import Timeline from './Timeline.svelte'
  import Volume from './Volume.svelte'

  let {
    player,
    asset,
    clip,
    aspect,
    muted,
    onTrim,
    onTrimEnd
  }: {
    player: Player
    asset: Asset
    clip: { start: number; end: number }
    /** The artboard's, for trim previews. */
    aspect: number
    /** Exported without sound. */
    muted: boolean
    onTrim: (start: number, end: number) => void
    onTrimEnd: (start: number, end: number) => void
  } = $props()

  const time = $derived(player.scrubTime ?? player.time)
</script>

<div class="player">
  <!-- Both glyphs stay mounted and crossfade, so the button never pops. -->
  <button
    class={['play', { playing: player.playing || player.queued, loading: player.queued, unavailable: player.unplayable }]}
    onclick={() => player.toggle()}
    title={player.unplayable ? 'This format can’t play here yet' : 'Play / Pause (Space)'}
  >
    <span class="glyph play-glyph"><Icon name="play" size={14} /></span>
    <span class="glyph pause-glyph"><Icon name="pause" size={14} /></span>
  </button>
  <span class="time">{fmtTime(Math.max(0, time - clip.start))}</span>
  <Timeline
    duration={asset.duration}
    start={clip.start}
    end={clip.end}
    {time}
    {aspect}
    onScrubStart={() => player.scrubStart()}
    onSeek={(t) => player.scrubTo(t)}
    onScrubEnd={(t) => player.scrubEnd(t)}
    onPreview={(canvas, t) => player.preview(canvas, t)}
    {onTrim}
    {onTrimEnd}
  />
  <span class="time muted">{fmtTime(clip.end - clip.start)}</span>
  {#if asset.audio === false || muted}
    <span class="icon-btn static" title={asset.audio === false ? 'No audio track' : 'Audio is muted for export'}><Icon name="volumeOff" /></span>
  {:else}
    <Volume />
  {/if}
</div>
