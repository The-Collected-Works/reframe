<!--
  In the title bar while videos' playback copies are being made: how many are done of how many,
  with the one in progress on the ring (or a sharper copy of the open video being made). Until a
  video's copy is ready it plays and scrubs more slowly (or, in a layout, shows a still), so this
  says why, and that it's on its way.
-->
<script lang="ts">
  import { Ring } from '../../ui'

  let { label, done, total, progress }: { label: string; done: number; total: number; progress: number } = $props()
</script>

<div
  class="activity"
  title="Making a copy of each video that plays and scrubs smoothly: what's open first, then the rest. They're kept, so each video only needs it once. Exports always use the originals."
>
  <Ring value={(done + progress) / total} size={14} />
  <span
    >{label}{#if total > 1}<span class="muted">&nbsp;{Math.min(done + 1, total)} of {total}</span>{/if}</span
  >
</div>

<style>
  .activity {
    display: flex;
    align-items: center;
    gap: 7px;
    height: 28px;
    padding: 0 10px 0 8px;
    border-radius: 14px;
    background: var(--tint-1);
    color: var(--text);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    -webkit-app-region: no-drag;
    animation: fade 200ms var(--ease) both;
  }

  .activity :global(.ring) {
    color: var(--accent);
  }
</style>
