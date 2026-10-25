<!-- Preview volume: global, remembered. Clicking the speaker toggles mute. -->
<script lang="ts">
  import { app } from '../../state/app.svelte'
  import Icon from '../../ui/Icon.svelte'
  import Slider from '../../ui/Slider.svelte'
</script>

<div class="volume">
  <button class="icon-btn" title={app.volume > 0 ? 'Mute preview' : 'Unmute preview'} onclick={() => app.setVolume(app.volume > 0 ? 0 : app.lastVolume)}>
    <Icon name={app.volume === 0 ? 'volumeOff' : app.volume < 0.5 ? 'volumeLow' : 'volumeHigh'} />
  </button>
  <Slider value={app.volume} min={0} max={1} step={0.01} width={64} bright onChange={(v) => app.setVolume(v)} />
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
