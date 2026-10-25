<!--
  One asset at a time, large: the stage, and floating over the band reserved at its bottom, the
  player (for videos) and the filmstrip.
-->
<script lang="ts">
  import { app } from '../../state/app.svelte'
  import { clipFor } from '../../state/project'
  import Icon from '../../ui/Icon.svelte'
  import Filmstrip from './Filmstrip.svelte'
  import { Player } from './player.svelte'
  import PlayerBar from './PlayerBar.svelte'
  import Stage from './Stage.svelte'

  const asset = $derived(app.asset(app.focus))
  // Position among what the grid shows (filtered, sorted, collapsed folders left out).
  const index = $derived(app.visible.findIndex((a) => a.name === app.focus))
  const count = $derived(app.visible.length)
  const settings = $derived(asset ? app.settingsOf(asset.name) : app.board.defaults)

  // While a trim handle is dragged its value lives here, and is saved once on release.
  let trimDraft = $derived.by((): { start: number; end: number } | null => {
    void app.focus
    return null
  })
  const clip = $derived(asset?.kind === 'video' ? (trimDraft ?? clipFor(app.project, asset.name, asset.duration)) : { start: 0, end: 0 })

  // A player per video file.
  const video = $derived(asset?.kind === 'video' ? `${asset.path}|${asset.mtime}` : null)
  let player = $state.raw<Player | null>(null)
  $effect(() => {
    if (!video) return
    const p = new Player({ asset: () => asset!, clip: () => clip, muted: () => settings.mute, board: () => app.board, settings: () => settings })
    player = p
    return () => {
      p.destroy()
      player = null
    }
  })

  function onTrimEnd(start: number, end: number) {
    trimDraft = null
    if (!asset) return
    app.setClip(asset.name, { start, end: end >= asset.duration - 0.01 ? null : end })
    // Keep the view's frame unless it's now outside the trimmed range.
    const v = player?.video
    if (v && (v.currentTime < start || v.currentTime > end)) player?.seek(start)
  }

  // Space plays and pauses.
  function onkeydown(e: KeyboardEvent) {
    if (e.code !== 'Space' || (e.target as HTMLElement).closest('input, textarea, button')) return
    e.preventDefault()
    player?.toggle()
  }
</script>

<svelte:window {onkeydown} />

<div class="single">
  <Stage {asset} {player} />
  <div class="single-fade"></div>
  <div class="single-overlay">
    {#if asset && player && asset.duration > 0}
      <PlayerBar
        {player}
        {asset}
        {clip}
        aspect={app.board.width / app.board.height}
        muted={settings.mute}
        onTrim={(start, end) => (trimDraft = { start, end })}
        {onTrimEnd}
      />
    {/if}
    <div class="film-row">
      <span class="film-count">{index + 1}<span class="muted">{` / ${count}`}</span></span>
      <button class="icon-btn" title="Previous (←)" disabled={index <= 0} onclick={() => app.step(-1)}><Icon name="prev" /></button>
      <Filmstrip />
      <button class="icon-btn" title="Next (→)" disabled={index >= count - 1} onclick={() => app.step(1)}><Icon name="next" /></button>
    </div>
  </div>
</div>
