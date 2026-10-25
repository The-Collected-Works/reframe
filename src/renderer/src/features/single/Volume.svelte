<!-- Preview volume: global, remembered. Clicking the speaker toggles mute. -->
<script lang="ts">
  import { Button, Slider } from '../../ui'

  let { volume, onChange, onToggleMute }: { volume: number; onChange: (v: number) => void; onToggleMute: () => void } = $props()
</script>

<div class="volume">
  <Button
    variant="icon"
    round
    icon={volume === 0 ? 'volumeOff' : volume < 0.5 ? 'volumeLow' : 'volumeHigh'}
    title={volume > 0 ? 'Mute preview' : 'Unmute preview'}
    onclick={onToggleMute}
  />
  <Slider value={volume} min={0} max={1} step={0.01} width={64} bright {onChange} />
</div>

<style>
  /* The speaker (click to mute) and a compact slider. Always shown, so the timeline never changes
     width under the pointer. */
  .volume {
    display: flex;
    align-items: center;
    padding-right: 6px;
  }
</style>
