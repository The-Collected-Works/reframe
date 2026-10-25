<!-- Play / pause, the time, the timeline with its trim handles, the trimmed length and the volume. -->
<script lang="ts">
  import { fmtTime } from '../../lib/format'
  import type { Asset } from '../../state/library.svelte'
  import { Icon } from '../../ui'
  import type { Player } from './player.svelte'
  import Timeline from './Timeline.svelte'
  import Volume from './Volume.svelte'

  let {
    player,
    asset,
    clip,
    aspect,
    muted,
    volume,
    onVolume,
    onToggleMute,
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
    /** The preview volume (0..1). */
    volume: number
    onVolume: (v: number) => void
    onToggleMute: () => void
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
    <span class="silent" title={asset.audio === false ? 'No audio track' : 'Audio is muted for export'}><Icon name="volumeOff" /></span>
  {:else}
    <Volume {volume} onChange={onVolume} {onToggleMute} />
  {/if}
</div>

<style>
  /* Floating glass over the media. */
  .player {
    width: min(720px, calc(100% - 48px));
    height: 44px;
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 0 8px 0 6px;
    border-radius: 22px;
    background: var(--glass-bg);
    backdrop-filter: var(--glass-filter);
    box-shadow: var(--glass-shadow);
  }

  /* Play / pause: a round button whose two glyphs crossfade with a little turn. */
  .play {
    position: relative;
    flex: none;
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: var(--tint-2);
    color: var(--text);
    transition:
      background-color var(--t-fast) var(--ease),
      transform var(--t-fast) var(--ease);
  }

  .play:hover {
    background: var(--tint-3);
  }

  .play:active {
    transform: scale(0.92);
  }

  .play.unavailable {
    color: var(--faint);
  }

  .glyph {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    transition:
      opacity 160ms var(--ease),
      transform 220ms var(--spring);
  }

  /* The play triangle's optical centre sits right of its box. */
  .play-glyph {
    padding-left: 2px;
  }

  .pause-glyph,
  .playing .play-glyph {
    opacity: 0;
    transform: scale(0.6) rotate(-30deg);
  }

  .playing .pause-glyph {
    opacity: 1;
    transform: none;
  }

  .loading .glyph {
    animation: pulse 1s ease-in-out infinite;
  }

  @keyframes pulse {
    50% {
      opacity: 0.35;
    }
  }

  .time {
    flex: none;
    width: 48px;
    text-align: center;
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    color: var(--text);
  }

  .time.muted {
    color: var(--muted);
  }

  /* No sound to control: just the muted speaker, where the volume would be. */
  .silent {
    display: inline-grid;
    place-items: center;
    flex-shrink: 0;
    width: 32px;
    height: 32px;
    color: var(--faint);
  }
</style>
