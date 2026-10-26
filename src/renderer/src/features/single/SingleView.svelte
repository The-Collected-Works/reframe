<!--
  One item at a time, large: the stage (or for a grid, the grid editor), and floating over the band
  reserved at its bottom, the player (for videos and grids with video) and the filmstrip. The
  single view's connection to app state; the parts inside take props.
-->
<script lang="ts">
  import { slotKey } from '@shared/grid'
  import { hint, useKeymap } from '../../lib/keymap.svelte'
  import { removeSlot, setMode, setSlot, swapSlots } from '../../state/actions'
  import { items } from '../../state/items.svelte'
  import { prioritize } from '../../state/loading'
  import { clipFor } from '../../state/model/project'
  import { preview } from '../../state/preview.svelte'
  import { project } from '../../state/project.svelte'
  import { selection } from '../../state/selection.svelte'
  import { shell } from '../../state/shell.svelte'
  import { view } from '../../state/view.svelte'
  import { Button } from '../../ui'
  import { SINGLE } from '../keymaps'
  import { assetMenu, slotMenu } from '../menus'
  import { gridScene } from '../scene'
  import Filmstrip from './Filmstrip.svelte'
  import { GridPlayer, type GridVideo } from './gridPlayer.svelte'
  import GridPlayerBar from './GridPlayerBar.svelte'
  import GridStage from './GridStage.svelte'
  import ItemPicker from './ItemPicker.svelte'
  import { Player } from './player.svelte'
  import PlayerBar from './PlayerBar.svelte'
  import Stage from './Stage.svelte'

  const focused = $derived(items.entry(selection.focus))
  const board = $derived(project.board)
  // A grid opens in the grid editor; anything else on the stage.
  const gridKey = $derived(focused?.kind === 'grid' ? focused.name : null)
  const scene = $derived(gridKey ? gridScene(gridKey, board) : null)
  const asset = $derived(gridKey ? undefined : items.asset(selection.focus))
  const settings = $derived(asset ? project.settingsOf(asset.name) : board.defaults)
  // Position among what the grid shows (filtered, sorted, collapsed folders left out).
  const strip = $derived(view.visible.map((e) => items.with(e)))
  const index = $derived(view.visible.findIndex((a) => a.name === selection.focus))
  const count = $derived(view.visible.length)

  // While a trim handle is dragged its value lives here, and is saved once on release.
  let trimDraft = $derived.by((): { start: number; end: number } | null => {
    void selection.focus
    return null
  })
  const clip = $derived(asset?.kind === 'video' ? (trimDraft ?? clipFor(project.file, asset.name, asset.duration)) : { start: 0, end: 0 })

  // A player per video file.
  const video = $derived(asset?.kind === 'video' ? `${asset.path}|${asset.mtime}` : null)
  let player = $state.raw<Player | null>(null)
  $effect(() => {
    if (!video) return
    const p = new Player({
      asset: () => asset!,
      clip: () => clip,
      muted: () => settings.mute,
      volume: () => preview.volume,
      picking: () => shell.picking,
      board: () => board,
      settings: () => settings
    })
    player = p
    return () => {
      p.destroy()
      player = null
    }
  })

  function onTrimEnd(start: number, end: number) {
    trimDraft = null
    if (!asset) return
    project.setClip(asset.name, { start, end: end >= asset.duration - 0.01 ? null : end })
    // Keep the view's frame unless it's now outside the trimmed range.
    const v = player?.video
    if (v && (v.currentTime < start || v.currentTime > end)) player?.seek(start)
  }

  // A grid's videos as it plays them, and its player.
  const gridVideos = $derived.by((): GridVideo[] => {
    if (!scene) return []
    return scene.layout.cells.flatMap(({ slot }) => {
      const a = scene.cells.get(slot.id)?.asset
      if (a?.kind !== 'video' || !a.duration) return []
      const c = clipFor(project.file, a.name, a.duration)
      return [{ slot: slot.id, path: a.path, start: c.start, length: c.end - c.start, end: slot.end ?? 'loop' }]
    })
  })
  let gridPlayer = $state.raw<GridPlayer | null>(null)
  $effect(() => {
    if (!gridKey) return
    const p = new GridPlayer(
      () => gridVideos,
      () => scene?.duration ?? 0
    )
    gridPlayer = p
    return () => {
      p.destroy()
      gridPlayer = null
    }
  })
  const choosing = $derived(shell.choosing && scene ? scene.layout.cells.find((c) => c.slot.id === shell.choosing) : undefined)

  // Space plays and pauses; any arrow steps through the strip. (The stage handles the rest.)
  useKeymap(SINGLE, {
    play: () => (gridKey ? gridPlayer?.toggle() : player?.toggle()),
    prev: () => selection.step(-1),
    next: () => selection.step(1)
  })
</script>

<div class="single">
  {#if scene && gridKey}
    <GridStage
      {board}
      {scene}
      slot={selection.slot}
      player={gridPlayer}
      picking={shell.picking}
      onSelect={(slot) => (selection.slot = slot)}
      onEdit={(slot, patch) => project.edit([slotKey(gridKey, slot)], patch)}
      onReset={(slot, keys) => project.resetKeys([slotKey(gridKey, slot)], keys)}
      onArrange={(split, weights) => project.setSplit(gridKey, split, { weights })}
      onSwap={swapSlots}
      onChoose={(slot) => {
        selection.slot = slot
        shell.choosing = slot
      }}
      onRemove={removeSlot}
      onMenu={(slot, at) => {
        const cell = scene.layout.cells.find((c) => c.slot.id === slot)
        const a = scene.cells.get(slot)?.asset
        slotMenu(slot, !!a, a?.kind === 'video', cell?.slot.end ?? 'loop', at)
      }}
      onExit={() => setMode('grid')}
    />
  {:else}
    <Stage
      {asset}
      {board}
      {settings}
      {player}
      picking={shell.picking}
      onEdit={(patch) => asset && project.edit([asset.name], patch)}
      onSelect={() => asset && !selection.has(asset.name) && selection.set([asset.name])}
      onReset={(keys) => asset && project.resetKeys([asset.name], keys)}
      onExit={() => setMode('grid')}
      onMenu={(at) => asset && assetMenu(asset.name, asset.path, at, true)}
    />
  {/if}
  <div class="single-fade"></div>
  <div class="single-overlay">
    {#if gridPlayer && scene?.duration}
      <GridPlayerBar player={gridPlayer} duration={scene.duration} />
    {:else if asset && player && asset.duration > 0}
      <PlayerBar
        {player}
        {asset}
        {clip}
        aspect={board.width / board.height}
        muted={settings.mute}
        volume={preview.volume}
        onVolume={(v) => preview.setVolume(v)}
        onToggleMute={() => preview.toggleMute()}
        onTrim={(start, end) => (trimDraft = { start, end })}
        {onTrimEnd}
      />
    {/if}
    <div class="film-row">
      <span class="film-count">{index + 1}<span class="muted">{` / ${count}`}</span></span>
      <Button variant="icon" icon="prev" title={`Previous (${hint(SINGLE.actions.prev)})`} disabled={index <= 0} onclick={() => selection.step(-1)} />
      <Filmstrip
        assets={strip}
        {board}
        focus={selection.focus}
        composite={(name) => gridScene(name, board)}
        onSelect={(name) => selection.select(name)}
        onSeen={(a) => prioritize(a.path)}
      />
      <Button variant="icon" icon="next" title={`Next (${hint(SINGLE.actions.next)})`} disabled={index >= count - 1} onclick={() => selection.step(1)} />
    </div>
  </div>
</div>

{#if choosing && gridKey}
  <ItemPicker
    assets={items.all.filter((e) => e.kind !== 'grid').map((e) => items.with(e))}
    current={choosing.slot.item}
    onChoose={(key) => {
      setSlot(choosing.slot.id, { item: key })
      shell.choosing = null
    }}
    onSeen={(a) => prioritize(a.path)}
    onClose={() => (shell.choosing = null)}
  />
{/if}

<style>
  .single {
    position: absolute;
    inset: 0;
  }

  /* Fades the viewport to its background behind the filmstrip, so the strip sits on solid ground. */
  .single-fade {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 130px;
    background: linear-gradient(to bottom, transparent, var(--well) 70%);
    pointer-events: none;
  }

  /* The bottom band of the stage (kept clear of the board; see Stage's reserved height). */
  .single-overlay {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 12px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    pointer-events: none;
    animation: rise-in 300ms var(--ease) 140ms both;
  }

  .single-overlay > :global(*) {
    pointer-events: auto;
  }

  /* The filmstrip with its count and arrows: a compact, centred cluster, no container. */
  .film-row {
    height: 64px;
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .film-count {
    min-width: 52px;
    margin-right: 4px;
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    text-align: center;
  }
</style>
