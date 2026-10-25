<!-- Preview volume: global, remembered. Clicking the speaker toggles mute. -->
<script lang="ts">
  import { app } from '../store.svelte'
  import Icon from '../ui/Icon.svelte'
  import Slider from '../ui/Slider.svelte'
</script>

<div class="volume">
  <button class="icon-btn" title={app.volume > 0 ? 'Mute preview' : 'Unmute preview'} onclick={() => app.setVolume(app.volume > 0 ? 0 : app.lastVolume)}>
    <Icon name={app.volume === 0 ? 'volumeOff' : app.volume < 0.5 ? 'volumeLow' : 'volumeHigh'} />
  </button>
  <Slider value={app.volume} min={0} max={1} step={0.01} onChange={(v) => app.setVolume(v)} />
</div>
