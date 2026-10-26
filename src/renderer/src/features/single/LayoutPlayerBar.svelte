<!-- A layout's playback: play / pause, the time, a bar to scrub along, and how long it runs. -->
<script lang="ts">
  import { trackPointer } from '../../lib/drag'
  import { fmtTime } from '../../lib/format'
  import { Icon } from '../../ui'
  import type { LayoutPlayer } from './layoutPlayer.svelte'

  let { player, duration }: { player: LayoutPlayer; duration: number } = $props()

  let track: HTMLDivElement
  const at = (clientX: number) => {
    const r = track.getBoundingClientRect()
    return (Math.min(Math.max(0, clientX - r.left), r.width) / r.width) * duration
  }
  function onpointerdown(e: PointerEvent) {
    if (e.button !== 0) return
    const resume = player.playing
    player.playing = false
    player.seek(at(e.clientX))
    trackPointer(e, {
      move: (ev) => player.seek(at(ev.clientX)),
      end: () => {
        if (resume) player.playing = true
      }
    })
  }
</script>

<div class="player">
  <button class={['play', { playing: player.playing }]} onclick={() => player.toggle()} title="Play / Pause (Space)">
    <span class="glyph play-glyph"><Icon name="play" size={14} /></span>
    <span class="glyph pause-glyph"><Icon name="pause" size={14} /></span>
  </button>
  <span class="time">{fmtTime(player.time)}</span>
  <div class="track" role="presentation" bind:this={track} {onpointerdown}>
    <div class="rail"><div class="fill" style:width={`${(player.time / duration) * 100}%`}></div></div>
    <div class="head" style:left={`${(player.time / duration) * 100}%`}></div>
    <!-- Each video's playback copy is being made: its cell shows a still until it's ready. -->
    {#if player.preparing}
      <span class="preparing" title="Making small copies of the videos that play and scrub smoothly. Exports use the originals."
        >Preparing playback · {player.preparing} to go</span
      >
    {/if}
  </div>
  <span class="time muted">{fmtTime(duration)}</span>
  <span class="silent" title="Layouts export without sound for now"><Icon name="volumeOff" /></span>
</div>

<style>
  /* Floating glass over the media, as a single video's player. */
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

  .track {
    position: relative;
    flex: 1;
    height: 32px;
    display: grid;
    align-items: center;
    cursor: pointer;
  }

  .rail {
    height: 4px;
    border-radius: 2px;
    background: var(--tint-2);
    overflow: hidden;
  }

  .fill {
    height: 100%;
    background: var(--muted);
  }

  .head {
    position: absolute;
    top: 50%;
    width: 2px;
    height: 16px;
    margin-left: -1px;
    border-radius: 1px;
    background: var(--text);
    transform: translateY(-50%);
    pointer-events: none;
  }

  .preparing {
    position: absolute;
    left: 50%;
    bottom: -2px;
    transform: translateX(-50%);
    color: var(--muted);
    font-size: 10px;
    white-space: nowrap;
    pointer-events: auto;
    animation: pulse 1.4s ease-in-out infinite;
  }

  @keyframes pulse {
    50% {
      opacity: 0.45;
    }
  }

  .silent {
    display: inline-grid;
    place-items: center;
    flex-shrink: 0;
    width: 32px;
    height: 32px;
    color: var(--faint);
  }
</style>
