<!--
  One item at a time, large: the stage (or for a layout, the layout editor), and floating over the band
  reserved at its bottom, the player (for videos and layouts with video) and the filmstrip. The
  single view's connection to app state; the parts inside take props.
-->
<script lang="ts">
  import { untrack } from 'svelte'
  import { slotKey } from '@shared/arrangement'
  import { computeLayout, drawFrame } from '@shared/layout'
  import { hint, useKeymap } from '../../lib/keymap.svelte'
  import { Playback, type Track } from '../../lib/playback/playback.svelte'
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
  import { layoutScene } from '../scene'
  import Filmstrip from './Filmstrip.svelte'
  import LayoutPlayerBar from './LayoutPlayerBar.svelte'
  import LayoutStage from './LayoutStage.svelte'
  import ItemPicker from './ItemPicker.svelte'
  import PlayerBar from './PlayerBar.svelte'
  import Stage from './Stage.svelte'

  const focused = $derived(items.entry(selection.focus))
  const board = $derived(project.board)
  // A layout opens in the layout editor; anything else on the stage.
  const layoutKey = $derived(focused?.kind === 'layout' ? focused.name : null)
  const scene = $derived(layoutKey ? layoutScene(layoutKey, board) : null)
  const asset = $derived(layoutKey ? undefined : items.asset(selection.focus))
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

  // A video's playback: one track, its trim the stretch that loops; sound from the file itself.
  // Remade for each item, so each starts where its trim does.
  /** Device pixels on screen, rounded so small zooms don't keep asking for another size. */
  const quantize = (px: number) => Math.ceil(px / 128) * 128
  let need = $state(0)
  const playable = $derived(asset?.kind === 'video' && asset.w > 0 ? asset.name : null)
  let playback = $state.raw<Playback | null>(null)
  $effect(() => {
    if (!playable) return
    const p = untrack(
      () =>
        new Playback({
          tracks: () => (asset?.kind === 'video' ? [{ id: asset.name, file: asset, start: 0, length: asset.duration, end: 'loop', need }] : []),
          range: () => clip,
          sound: () => (asset && asset.audio !== false ? { track: asset.name, volume: settings.mute ? 0 : preview.volume } : null),
          hold: () => shell.picking,
          originals: true
        })
    )
    p.seek(untrack(() => clip.start))
    playback = p
    return () => {
      p.destroy()
      playback = null
    }
  })

  function onTrimEnd(start: number, end: number) {
    trimDraft = null
    if (!asset) return
    project.setClip(asset.name, { start, end: end >= asset.duration - 0.01 ? null : end })
    // Keep the view's frame unless it's now outside the trimmed range.
    if (playback && (playback.time < start || playback.time > end)) playback.seek(start)
  }

  /** A trim handle's preview: the frame at `t`, framed as the artboard frames it. */
  function onPreview(canvas: HTMLCanvasElement, t: number) {
    const a = asset
    if (!a || !playback) return
    playback.preview(a.name, t, (src) => drawFrame(canvas.getContext('2d')!, src, a.w, a.h, board.width, board.height, settings, canvas.width / board.width))
  }

  // A layout's playback: a track per video cell, each the part of its file the cell plays, sized
  // to the cell on screen. No sound yet (the export has none either).
  let scale = $state(1)
  const layoutTracks = $derived.by((): Track[] => {
    if (!scene) return []
    return scene.arrangement.cells.flatMap(({ slot, rect }) => {
      const cell = scene.cells.get(slot.id)
      const a = cell?.asset
      if (a?.kind !== 'video' || !a.duration || !a.w) return []
      const c = clipFor(project.file, a.name, a.duration)
      const p = computeLayout(rect.w, rect.h, a.w, a.h, cell!.settings)
      return [{ id: slot.id, file: a, start: c.start, length: c.end - c.start, end: slot.end ?? 'loop', need: quantize(Math.max(p.w, p.h) * scale) }]
    })
  })
  let layoutPlayback = $state.raw<Playback | null>(null)
  $effect(() => {
    if (!layoutKey) return
    const p = new Playback({
      tracks: () => layoutTracks,
      range: () => ({ start: 0, end: scene?.duration ?? 0 }),
      hold: () => shell.picking
    })
    layoutPlayback = p
    return () => {
      p.destroy()
      layoutPlayback = null
    }
  })
  const choosing = $derived(shell.choosing && scene ? scene.arrangement.cells.find((c) => c.slot.id === shell.choosing) : undefined)

  // Space plays and pauses; any arrow steps through the strip. (The stage handles the rest.)
  useKeymap(SINGLE, {
    play: () => (layoutKey ? layoutPlayback : playback)?.toggle(),
    prev: () => selection.step(-1),
    next: () => selection.step(1)
  })
</script>

<div class="single">
  {#if scene && layoutKey}
    <LayoutStage
      {board}
      {scene}
      slot={selection.slot}
      player={layoutPlayback}
      picking={shell.picking}
      onScale={(k) => (scale = k)}
      onSelect={(slot) => (selection.slot = slot)}
      onEdit={(slot, patch) => project.edit([slotKey(layoutKey, slot)], patch)}
      onReset={(slot, keys) => project.resetKeys([slotKey(layoutKey, slot)], keys)}
      onArrange={(split, weights) => project.setSplit(layoutKey, split, { weights })}
      onSwap={swapSlots}
      onChoose={(slot) => {
        selection.slot = slot
        shell.choosing = slot
      }}
      onRemove={removeSlot}
      onMenu={(slot, at) => {
        const cell = scene.arrangement.cells.find((c) => c.slot.id === slot)
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
      {playback}
      picking={shell.picking}
      onNeed={(px) => (need = quantize(px))}
      onEdit={(patch) => asset && project.edit([asset.name], patch)}
      onSelect={() => asset && !selection.has(asset.name) && selection.set([asset.name])}
      onReset={(keys) => asset && project.resetKeys([asset.name], keys)}
      onExit={() => setMode('grid')}
      onMenu={(at) => asset && assetMenu(asset.name, asset.path, at, true)}
    />
  {/if}
  <div class="single-fade"></div>
  <div class="single-overlay">
    {#if layoutPlayback && scene?.duration}
      <LayoutPlayerBar player={layoutPlayback} duration={scene.duration} />
    {:else if asset && playback && asset.duration > 0}
      <PlayerBar
        {playback}
        {asset}
        {clip}
        aspect={board.width / board.height}
        muted={settings.mute}
        volume={preview.volume}
        onVolume={(v) => preview.setVolume(v)}
        onToggleMute={() => preview.toggleMute()}
        {onPreview}
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
        composite={(name) => layoutScene(name, board)}
        onSelect={(name) => selection.select(name)}
        onSeen={(a) => prioritize(a.path)}
      />
      <Button variant="icon" icon="next" title={`Next (${hint(SINGLE.actions.next)})`} disabled={index >= count - 1} onclick={() => selection.step(1)} />
    </div>
  </div>
</div>

{#if choosing && layoutKey}
  <ItemPicker
    assets={items.all.filter((e) => e.kind !== 'layout').map((e) => items.with(e))}
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
