<!--
  Play / pause, the time, the timeline (with trim handles for a video), how long it runs, and the
  sound: the one player bar, for a video and for a composition.
-->
<script lang="ts">
  import { fmtTime } from '../../lib/format'
  import type { Player } from '../../state/playback.svelte'
  import { Icon } from '../../ui'
  import Preparing from './Preparing.svelte'
  import Timeline, { type Trim } from './Timeline.svelte'
  import Volume from './Volume.svelte'

  let {
    player,
    duration,
    trim,
    sound,
    preparing,
    cached
  }: {
    player: Player
    /** The timeline's length (seconds): a video's whole file, or a composition's. */
    duration: number
    /** A video's trim: what plays, and handles to change it. Without, all of it plays. */
    trim?: Trim
    /** The volume, or why there's none (no audio, muted for export, no sound in compositions yet). */
    sound: { volume: number; onVolume: (v: number) => void; onToggleMute: () => void } | { silent: string }
    /** Its playback copies being made (or waiting to be): what to say, and how far along. */
    preparing: { label: string; progress: number | null } | null
    /** How far it plays smoothly (seconds), for the timeline's cache line. */
    cached: number
  } = $props()

  const time = $derived(player.time)
  const start = $derived(trim?.start ?? 0)
  const end = $derived(trim?.end ?? duration)
</script>

<div class="player">
  {#if preparing}<Preparing {...preparing} />{/if}
  <!-- Both glyphs stay mounted and crossfade, so the button never pops. -->
  <button class={['play', { playing: player.playing, loading: player.waiting }]} onclick={() => player.toggle()} title="Play / Pause (Space)">
    <span class="glyph play-glyph"><Icon name="play" size={14} /></span>
    <span class="glyph pause-glyph"><Icon name="pause" size={14} /></span>
  </button>
  <span class="time">{fmtTime(Math.max(0, time - start))}</span>
  <Timeline
    {duration}
    {time}
    {trim}
    {cached}
    onScrubStart={() => player.scrubStart()}
    onSeek={(t) => player.scrubTo(t)}
    onScrubEnd={(t) => player.scrubEnd(t)}
  />
  <span class="time muted">{fmtTime(end - start)}</span>
  {#if 'silent' in sound}
    <span class="silent" title={sound.silent}><Icon name="volumeOff" /></span>
  {:else}
    <Volume volume={sound.volume} onChange={sound.onVolume} onToggleMute={sound.onToggleMute} />
  {/if}
</div>

<style>
  /* Floating glass over the media. */
  .player {
    position: relative;
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
