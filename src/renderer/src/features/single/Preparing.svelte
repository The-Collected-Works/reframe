<!--
  Above a player bar while its videos' playback copies are being made: what's happening, and how
  far along. Until then playing and scrubbing are slower (or show stills), so it says why.
-->
<script lang="ts">
  import { Ring } from '../../ui'

  let { label, progress }: { label: string; progress: number | null } = $props()
</script>

<div class="preparing" title="Making a copy of each video that plays and scrubs smoothly. Exports always use the originals.">
  <Ring value={progress} size={12} />
  <span>{label}{progress != null ? ` · ${Math.round(progress * 100)}%` : ''}</span>
</div>

<style>
  /* Floating glass, centred just above the bar it belongs to: inside the band the stage keeps clear
     above the bar (24px; see Stage's RESERVED), so it never covers the board. */
  .preparing {
    position: absolute;
    left: 50%;
    bottom: calc(100% + 3px);
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 6px;
    height: 20px;
    padding: 0 9px 0 5px;
    border-radius: 10px;
    background: var(--glass-bg);
    backdrop-filter: var(--glass-filter);
    box-shadow: var(--glass-shadow);
    color: var(--muted);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    animation: rise-in 220ms var(--ease) both;
  }
</style>
