<!--
  One item at a time, large: the stage (or for a composition, the composition editor), and floating over the band
  reserved at its bottom, the player (for videos and compositions with video) and the filmstrip. The
  single view's connection to app state; the parts inside take props.
-->
<script lang="ts">
  import { untrack } from 'svelte'
  import { dirsOn, slotKey } from '@shared/composition/bento'
  import { drawFrame } from '@shared/framing/framing'
  import { hint, useKeymap } from '../../lib/keymap.svelte'
  import {
    addCell,
    canGroupNodes,
    canUngroupNode,
    evenOut,
    flipGroup,
    groupNodes,
    moveIntoGroup,
    moveNode,
    removeNode,
    setMode,
    setSlot,
    swapSlots,
    ungroupNode
  } from '../../state/actions'
  import { items } from '../../state/items.svelte'
  import { prioritize } from '../../state/loading'
  import { newSlotId } from '../../state/model/items'
  import { clipFor } from '../../state/model/project'
  import { preview } from '../../state/preview.svelte'
  import { project } from '../../state/project.svelte'
  import { selection } from '../../state/selection.svelte'
  import { copies, Player, sizesOf, SOON } from '../../state/playback.svelte'
  import { storedOutline, storeOutline } from '../../state/prefs'
  import { shell } from '../../state/shell.svelte'
  import { view } from '../../state/view.svelte'
  import { Button } from '../../ui'
  import { SINGLE } from '../../config/keymaps'
  import { assetMenu, slotMenu } from '../menus'
  import { composed, composedWith, quantize, tracksOf } from '../../state/composition'
  import Filmstrip from './Filmstrip.svelte'
  import CompositionStage from './composition/CompositionStage.svelte'
  import Outline from './composition/Outline.svelte'
  import ItemPicker from './ItemPicker.svelte'
  import PlayerBar from './PlayerBar.svelte'
  import Stage from './Stage.svelte'

  const focused = $derived(items.entry(selection.focus))
  const board = $derived(project.board)
  // A composition opens in the composition editor; anything else on the stage.
  const compositionKey = $derived(focused?.kind === 'composition' ? focused.name : null)
  const comp = $derived(compositionKey ? composed(compositionKey, board) : null)
  const asset = $derived(compositionKey ? undefined : items.asset(selection.focus))
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
  let need = $state(0)
  const playable = $derived(asset?.kind === 'video' && asset.w > 0 ? asset.name : null)
  let playback = $state.raw<Player | null>(null)
  $effect(() => {
    if (!playable) return
    const p = untrack(
      () =>
        new Player({
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

  // While its copy is being made it plays from the original, which is slower: say so.
  const preparing = $derived.by(() => {
    if (asset?.kind !== 'video' || !asset.w || !copies.pending(asset)) return null
    const st = copies.state(asset)
    return st?.state === 'making'
      ? { label: 'Preparing smooth playback', progress: st.progress }
      : { label: 'Waiting to prepare smooth playback', progress: null }
  })

  // The videos either side in the filmstrip are likely next: their copies come before the rest.
  $effect(() => {
    const near = [strip[index - 1], strip[index + 1]].filter((a) => a?.kind === 'video' && a.w > 0)
    const withdraw = untrack(() => near.map((a) => copies.want(a, sizesOf(a)[0], SOON)))
    return () => withdraw.forEach((w) => w())
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

  // A composition's playback: a track per video layer, each the part of its file the layer plays,
  // sized to it on screen. No sound yet (the export has none either).
  let scale = $state(1)
  const compositionTracks = $derived(comp ? tracksOf(comp, scale) : [])
  // Until every cell has a copy, the ones without show stills: say how many, and how far along.
  // How far into the composition every cell plays smoothly: a cell whose copy is still being made is
  // ready as far as it's encoded past its trim's start (the first time round).
  const compositionCached = $derived.by(() => {
    let reach = comp?.duration ?? 0
    for (const t of compositionTracks) {
      const r = copies.ready(t.file)
      if (r < t.start + t.length - 0.05) reach = Math.min(reach, Math.max(0, r - t.start))
    }
    return reach
  })

  const compositionPreparing = $derived.by(() => {
    const waiting = [...new Map(compositionTracks.filter((t) => copies.pending(t.file)).map((t) => [t.file.path, t.file])).values()]
    if (!waiting.length) return null
    const making = waiting.map((f) => copies.state(f)).find((s) => s?.state === 'making')
    return { label: `Preparing playback · ${waiting.length} to go`, progress: making?.state === 'making' ? making.progress : null }
  })
  let compositionPlayer = $state.raw<Player | null>(null)
  $effect(() => {
    if (!compositionKey) return
    const p = new Player({
      tracks: () => compositionTracks,
      range: () => ({ start: 0, end: comp?.duration ?? 0 }),
      hold: () => shell.picking
    })
    compositionPlayer = p
    return () => {
      p.destroy()
      compositionPlayer = null
    }
  })
  // A composition's outline, in the panel at the left: open or not (remembered), the row or cell
  // pointed at (here or on the stage), and a row being dragged (the stage shows where it'd land).
  let outlineOpen = $state(storedOutline())
  let structureHover = $state<string | null>(null)
  let outlineDrag = $state<{ moving: string; into: { parent: string; index: number } | null } | null>(null)
  const choosing = $derived(shell.choosing && comp ? comp.arrangement.cells.find((c) => c.slot.id === shell.choosing) : undefined)

  // Space plays and pauses; any arrow steps through the strip. (The stage handles the rest.)
  useKeymap(SINGLE, {
    play: () => (compositionKey ? compositionPlayer : playback)?.toggle(),
    prev: () => selection.step(-1),
    next: () => selection.step(1)
  })
</script>

<div class="single">
  <!-- Where it is, open or closed: the top left (in the panel, or of the viewport with it gone). -->
  {#if comp && compositionKey}
    <span class="outline-toggle">
      <Button
        variant="icon"
        icon="panel"
        iconSize={15}
        pressed={outlineOpen}
        title={outlineOpen ? 'Hide the outline' : 'Show the outline'}
        onclick={() => storeOutline((outlineOpen = !outlineOpen))}
      />
    </span>
  {/if}
  {#if comp && compositionKey}
    <!-- The composition's structure, on the same ground as the viewport. Folding it away slides it
         shut, the stage (and the player and filmstrip under it) widening as it goes. -->
    <aside class={['structure', { closed: !outlineOpen }]} inert={!outlineOpen}>
      <div class="structure-rows">
        <Outline
          root={comp.item.root}
          dirOf={dirsOn(comp.arrangement)}
          cellOf={(id) => {
            const s = comp.layers.find((l) => l.id === id)?.source
            return s ? { label: s.label, thumb: s.thumb, w: s.w, h: s.h } : null
          }}
          selected={selection.nodes}
          hover={structureHover}
          onSelect={(id, add) => {
            shell.adjusting = null
            if (add) selection.toggleNode(id)
            else selection.node = id
          }}
          onHover={(id) => (structureHover = id)}
          onFlip={flipGroup}
          onLanding={(moving, into) => (outlineDrag = moving ? { moving, into } : null)}
          onDrop={(moving, into) => moveIntoGroup(moving, into.parent, into.index)}
        />
      </div>
    </aside>
  {/if}
  <div class="main">
    {#if comp && compositionKey}
      <CompositionStage
        {board}
        {comp}
        node={selection.node}
        nodes={selection.nodes}
        adjusting={shell.adjusting}
        bind:hover={structureHover}
        {outlineDrag}
        player={compositionPlayer}
        picking={shell.picking}
        canUngroup={canUngroupNode}
        canGroup={canGroupNodes}
        onScale={(k) => (scale = k)}
        recompose={(root, born) => composedWith(compositionKey, board, root, born)}
        newId={newSlotId}
        onSelect={(id) => (selection.node = id)}
        onToggle={(id) => selection.toggleNode(id)}
        onAdjust={(slot) => (shell.adjusting = slot)}
        onEdit={(slot, patch) => project.edit([slotKey(compositionKey, slot)], patch)}
        onReset={(slot, keys) => project.resetKeys([slotKey(compositionKey, slot)], keys)}
        onArrange={(split, weights) => project.setSplit(compositionKey, split, { weights })}
        onEvenOut={evenOut}
        onAdd={addCell}
        onMove={moveNode}
        onSwap={swapSlots}
        onRemove={removeNode}
        onFlip={flipGroup}
        onUngroup={ungroupNode}
        onGroup={groupNodes}
        onChoose={(slot) => {
          selection.node = slot
          shell.choosing = slot
        }}
        onHold={(slot, hold) => setSlot(slot, { end: hold ? 'hold' : 'loop' })}
        onMenu={(slot, at) => {
          const layer = comp.layers.find((l) => l.id === slot)
          slotMenu(slot, !!layer?.source, layer?.source?.kind === 'video', layer?.end ?? 'loop', at)
        }}
        onExit={() => setMode('grid')}
      />
    {:else}
      <Stage
        {asset}
        {board}
        {settings}
        {playback}
        start={clip.start}
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
      {#if compositionPlayer && comp?.duration}
        <PlayerBar
          player={compositionPlayer}
          duration={comp.duration}
          sound={{ silent: 'Compositions export without sound for now' }}
          preparing={compositionPreparing}
          cached={compositionCached}
        />
      {:else if asset && playback && asset.duration > 0}
        <PlayerBar
          player={playback}
          duration={asset.duration}
          trim={{
            start: clip.start,
            end: clip.end,
            aspect: board.width / board.height,
            onPreview,
            onTrim: (start, end) => (trimDraft = { start, end }),
            onTrimEnd
          }}
          sound={asset.audio === false
            ? { silent: 'No audio track' }
            : settings.mute
              ? { silent: 'Audio is muted for export' }
              : { volume: preview.volume, onVolume: (v) => preview.setVolume(v), onToggleMute: () => preview.toggleMute() }}
          {preparing}
          cached={copies.ready(asset)}
        />
      {/if}
      <div class="film-row">
        <span class="film-count">{index + 1}<span class="muted">{` / ${count}`}</span></span>
        <Button variant="icon" icon="prev" title={`Previous (${hint(SINGLE.actions.prev)})`} disabled={index <= 0} onclick={() => selection.step(-1)} />
        <Filmstrip
          assets={strip}
          {board}
          focus={selection.focus}
          composite={(name) => composed(name, board)}
          onSelect={(name) => selection.select(name)}
          onSeen={(a) => prioritize(a.path)}
        />
        <Button variant="icon" icon="next" title={`Next (${hint(SINGLE.actions.next)})`} disabled={index >= count - 1} onclick={() => selection.step(1)} />
      </div>
    </div>
  </div>
</div>

{#if choosing && compositionKey}
  <ItemPicker
    assets={items.all.filter((e) => e.kind !== 'composition').map((e) => items.with(e))}
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
    display: flex;
  }

  /* A composition's outline: a panel of its own at the left, on the viewport's own ground. */
  .structure {
    flex: none;
    width: 232px;
    overflow: hidden;
    border-right: 1px solid var(--line);
    background: var(--well);
    transition: width 260ms var(--ease);
  }

  .structure.closed {
    width: 0;
    border-right-width: 0;
  }

  /* Its full width while it slides, so the rows don't reflow: they slide out of sight with it. */
  .structure-rows {
    width: 232px;
    height: 100%;
    padding: 44px 8px 12px;
    overflow-y: auto;
    transition: opacity 200ms var(--ease);
  }

  .structure.closed .structure-rows {
    opacity: 0;
  }

  @media (prefers-reduced-motion: reduce) {
    .structure,
    .structure-rows {
      transition: none;
    }
  }

  /* Everything else: the stage, and the player and filmstrip centred under it. */
  .main {
    position: relative;
    flex: 1;
    min-width: 0;
  }

  .outline-toggle {
    position: absolute;
    top: 8px;
    left: 8px;
    z-index: 6;
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
