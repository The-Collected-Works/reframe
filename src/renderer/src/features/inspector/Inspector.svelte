<!--
  The settings of the selection, or with nothing selected, the artboard's defaults that every asset
  follows. A dot beside a setting marks it as changed from the defaults (click to reset it; "Make
  default" turns it into the default). A composition shows its own settings, and a cell being edited in
  one its framing there. The inspector's connection to app state.
-->
<script lang="ts">
  import { dirsOn } from '@shared/composition/bento'
  import type { Attachment } from 'svelte/attachments'
  import { slotsOf } from '@shared/composition/bento'
  import { DEFAULT_SETTINGS, normDeg, resolveSettings } from '@shared/framing/framing'
  import type { CropSettings, FitMode, CompositionItem, SettingKey } from '@shared/types'
  import { fmtSize, fmtTime, plural } from '../../lib/format'
  import { hint } from '../../lib/keymap.svelte'
  import {
    clearSelection,
    copy,
    edit,
    editEach,
    editingSlot,
    evenOut,
    makeDefault,
    paste,
    renameItem,
    resetKeys,
    resetSelection,
    setGroupDir,
    setSlot,
    targets
  } from '../../state/actions'
  import { items } from '../../state/items.svelte'
  import type { Asset } from '../../state/library.svelte'
  import { COMPOSITION_TYPES } from '../../config/compositions'
  import { compositionOf, isVirtual } from '../../state/model/items'
  import { hasOverrides } from '../../state/model/project'
  import { project } from '../../state/project.svelte'
  import { selection } from '../../state/selection.svelte'
  import { shell } from '../../state/shell.svelte'
  import { view } from '../../state/view.svelte'
  import { Button, ColorPicker, Icon, NumberField, Segmented, Slider, Tag, Toggle } from '../../ui'
  import { GLOBAL } from '../../config/keymaps'
  import { composed } from '../../state/composition'
  import { ZOOM_MAX, ZOOM_MIN } from '@shared/framing/snapping'
  import AnchorGrid from './AnchorGrid.svelte'
  import { pickBackground } from './eyedropper'
  import CompositionInspector from './CompositionInspector.svelte'
  import CompositionStructure from './CompositionStructure.svelte'
  import Row from './Row.svelte'

  const FITS: { value: FitMode; label: string; title: string }[] = [
    { value: 'fill', label: 'Fill', title: 'Cover the artboard' },
    { value: 'fit', label: 'Fit', title: 'Fit inside the artboard' },
    { value: 'width', label: 'W', title: 'Fit width' },
    { value: 'height', label: 'H', title: 'Fit height' },
    { value: 'stretch', label: 'Stretch', title: 'Stretch to fill' }
  ]

  const board = $derived(project.board)
  const isComposition = (key: string) => items.entry(key)?.kind === 'composition'
  // In the single view on a composition: that composition, and the cell being framed in it (if one is).
  const openComposition = $derived(view.mode === 'single' && selection.focus && isComposition(selection.focus) ? selection.focus : null)
  const slotKey = $derived(editingSlot())
  /** The compositions whose settings show: the open one with no cell chosen, or a selection of only compositions. */
  const compositions = $derived(
    openComposition ? (slotKey ? [] : [openComposition]) : selection.names.length && selection.names.every(isComposition) ? selection.names : []
  )
  const compositionKey = $derived(compositions.length ? (selection.focus && compositions.includes(selection.focus) ? selection.focus : compositions[0]) : null)
  const composition = $derived(compositionOf(project.file, compositionKey))
  // The open composition as it sits here, for a cell's size and what it shows.
  const comp = $derived(openComposition ? composed(openComposition, board) : null)
  const slotCell = $derived(slotKey && comp ? comp.arrangement.cells.find((c) => c.slot.id === selection.node) : undefined)
  const slotAsset = $derived(slotCell?.slot.item ? items.asset(slotCell.slot.item) : undefined)

  /** What edits apply to (see `targets`): a cell, or the selected assets (not compositions). */
  const names = $derived(slotKey ? [slotKey] : targets())
  const editing = $derived(names.length > 0)
  /** The asset whose values are shown: the focused one if it's selected, else the first. */
  const primary = $derived(slotKey ?? (editing ? (selection.focus && names.includes(selection.focus) ? selection.focus : names[0]) : null))
  const primaryAsset = $derived(slotKey ? slotAsset : names.length === 1 ? items.asset(primary) : undefined)
  // The selected assets, found in one pass (selections can be the whole folder).
  const chosen = $derived(slotKey ? (slotAsset ? [slotAsset] : []) : items.all.filter((a) => a.kind !== 'composition' && selection.has(a.name)))
  const s: CropSettings = $derived(primary ? resolveSettings(board, primary) : board.defaults)
  // A cell's framing is measured in the cell, as an asset's is in the artboard.
  const W = $derived(slotCell?.rect.w ?? board.width)
  const H = $derived(slotCell?.rect.h ?? board.height)

  const overridden = (keys: SettingKey[]) => editing && names.some((n) => keys.some((k) => board.overrides[n]?.[k] !== undefined))
  const hasVideo = $derived((editing ? chosen : items.all).some((a) => a.kind === 'video'))
  const anyOverride = $derived(editing && names.some((n) => hasOverrides(board, n)))
  // How much of the selection goes into this artboard's export: all of it, none, or some.
  const exported = $derived(names.filter((n) => !resolveSettings(board, n).skip).length)
  const mixedExport = $derived(exported > 0 && exported < names.length)

  const rp = (keys: SettingKey[]) => ({
    overridden: overridden(keys),
    onReset: () => resetKeys(keys),
    // A cell's values aren't made defaults: the artboard's defaults are for whole artboards.
    onMakeDefault: slotKey ? undefined : () => makeDefault(keys)
  })

  // Middle-click on a field: an asset drops that override and follows the artboard again; the
  // artboard's own defaults go back to the built-in values.
  const back =
    (...keys: SettingKey[]) =>
    () =>
      editing ? resetKeys(keys) : edit(Object.fromEntries(keys.map((k) => [k, DEFAULT_SETTINGS[k]])) as Partial<CropSettings>)

  /** ["1920×1080", "0:04.0", "29.97 fps", "3.2 MB"]. The name above already shows the type. */
  function describe(a: Asset): string[] {
    const parts: string[] = []
    if (a.w) parts.push(`${a.w}×${a.h}`)
    if (a.kind === 'video' && a.duration > 0) parts.push(fmtTime(a.duration))
    // Two decimals at most: 23.976 reads as 23.98, 30.00 as 30.
    if (a.kind === 'video' && a.fps) parts.push(`${Number(a.fps.toFixed(2))} fps`)
    parts.push(fmtSize(a.size))
    return parts.filter(Boolean)
  }

  const label = (key: string | null) => (key ? (items.entry(key)?.label ?? key) : '')
  const title = $derived(slotKey ? (slotAsset?.label ?? 'Empty cell') : names.length === 1 ? label(primary) : `${names.length} assets`)
  const tags = $derived(
    slotKey
      ? [...(slotCell ? [`Cell ${slotCell.rect.w}×${slotCell.rect.h}`] : []), ...(slotAsset ? describe(slotAsset).slice(0, 2) : [])]
      : !editing
        ? [
            `${board.width}×${board.height}`,
            plural(items.all.filter((a) => a.kind !== 'composition').length, 'asset'),
            plural(items.all.filter((a) => hasOverrides(board, a.name)).length, 'adjusted', 'adjusted')
          ]
        : names.length === 1 && primaryAsset
          ? describe(primaryAsset)
          : [
              ...(chosen.some((a) => a.kind === 'video') ? [plural(chosen.filter((a) => a.kind === 'video').length, 'video')] : []),
              ...(chosen.some((a) => a.kind === 'image') ? [plural(chosen.filter((a) => a.kind === 'image').length, 'image')] : []),
              fmtSize(chosen.reduce((n, a) => n + a.size, 0))
            ]
  )

  // A composition's settings apply to every selected composition; leaving out, to them all too.
  const compositionTags = $derived(
    composition && compositionKey
      ? [
          ...(compositions.length > 1 ? [plural(compositions.length, 'composition')] : [COMPOSITION_TYPES[composition.type], `${board.width}×${board.height}`]),
          plural(slotsOf(composition.root).length, 'cell'),
          ...(comp?.duration ? [fmtTime(comp.duration)] : [])
        ]
      : []
  )
  /** A composition's longest video, as trimmed (0: none). */
  function longestOf(key: string): number {
    const g = compositionOf(project.file, key)
    if (!g) return 0
    return Math.max(
      0,
      ...slotsOf(g.root).map((sl) => {
        const a = sl.item ? items.asset(sl.item) : undefined
        if (a?.kind !== 'video' || !a.duration) return 0
        const c = project.file.clips[a.name]
        return (c?.end ?? a.duration) - (c?.start ?? 0)
      })
    )
  }
  const compositionSkip = $derived(compositions.filter((k) => resolveSettings(board, k).skip).length)
  const editCompositions = (patch: Partial<CompositionItem>) => compositions.forEach((k) => project.editComposition(k, patch))

  // Renaming a variant or composition in place: click its name above. Enter or leaving it saves, Esc cancels.
  let renaming = $state(false)
  const renameKey = $derived(composition ? compositionKey : names.length === 1 && primary && isVirtual(primary) && !slotKey ? primary : null)
  $effect(() => {
    // Asked from a menu while the grid's captions aren't showing to rename in.
    if (shell.renamingItem && shell.renamingItem === renameKey && !(view.mode === 'grid' && view.prefs.names)) {
      shell.renamingItem = null
      renaming = true
    }
  })
  const renameField: Attachment<HTMLInputElement> = (input) => {
    let done = false
    const key = renameKey
    const finish = (save: boolean) => {
      if (done) return
      done = true
      renaming = false
      if (save && key) renameItem(key, input.value)
    }
    const onkeydown = (e: KeyboardEvent) => {
      e.stopPropagation()
      if (e.key === 'Enter') finish(true)
      else if (e.key === 'Escape') finish(false)
    }
    const onblur = () => finish(true)
    input.addEventListener('keydown', onkeydown)
    input.addEventListener('blur', onblur)
    input.focus()
    input.select()
    return () => {
      input.removeEventListener('keydown', onkeydown)
      input.removeEventListener('blur', onblur)
    }
  }
</script>

<aside class="inspector">
  <header class="insp-head">
    <!-- Breadcrumb: the artboard's defaults are the parent of whatever is selected; a composition is the
         parent of its cells. -->
    <nav class="crumbs">
      {#if composition && compositionKey}
        <button class="crumb" title={`Edit the defaults every asset follows (${hint(GLOBAL.actions.back)})`} onclick={() => clearSelection()}
          >{board.name}</button
        >
        <span class="crumb-sep"><Icon name="next" size={12} /></span>
        {@render current(compositions.length > 1 ? plural(compositions.length, 'composition') : composition.name, compositions.length === 1)}
      {:else if slotKey && openComposition}
        <span class="crumb muted-crumb">{board.name}</span>
        <span class="crumb-sep"><Icon name="next" size={12} /></span>
        <button class="crumb" title="The composition's own settings" onclick={() => (selection.node = null)}>{label(openComposition)}</button>
        <span class="crumb-sep"><Icon name="next" size={12} /></span>
        <span class="crumb current" {title}>{title}</span>
      {:else if editing}
        <button class="crumb" title={`Edit the defaults every asset follows (${hint(GLOBAL.actions.back)})`} onclick={() => clearSelection()}
          >{board.name}</button
        >
        <span class="crumb-sep"><Icon name="next" size={12} /></span>
        {@render current(title, !!renameKey)}
      {:else}
        <span class="crumb current">{board.name}</span>
      {/if}
    </nav>
    <div class="tags">
      {#each composition ? compositionTags : tags as t (t)}<Tag>{t}</Tag>{/each}
    </div>
  </header>

  {#snippet structure()}
    {#if comp && openComposition}
      <CompositionStructure
        root={comp.item.root}
        dirOf={dirsOn(comp.arrangement)}
        labelOf={(id) => comp.layers.find((l) => l.id === id)?.source?.label ?? 'Empty'}
        selected={selection.node}
        onSelect={(id) => (selection.node = id)}
        onDir={setGroupDir}
        onEvenOut={evenOut}
      />
    {/if}
  {/snippet}

  {#snippet current(text: string, renamable: boolean)}
    {#if renaming && renamable}
      <input class="crumb-rename" value={text} aria-label="Name" spellcheck="false" {@attach renameField} />
    {:else if renamable}
      <button class="crumb current" title="Rename" onclick={() => (renaming = true)}>{text}</button>
    {:else}
      <span class="crumb current" title={text}>{text}</span>
    {/if}
  {/snippet}

  {#if composition && compositionKey}
    <div class="insp-body">
      <CompositionInspector
        {composition}
        boardName={board.name}
        arranged={!!board.splits?.[compositionKey]}
        longest={longestOf(compositionKey)}
        picking={shell.picking}
        pickHint={hint(GLOBAL.actions.pick)}
        onEdit={editCompositions}
        onResetArrangement={() => compositions.forEach((k) => project.resetSplits(k))}
        onPick={pickBackground}
      />
      {@render structure()}
    </div>
    <footer class="insp-foot">
      <div class="spacer"></div>
      <Button
        variant="icon"
        icon="leaveOut"
        iconSize={14}
        tone="danger"
        pressed={compositionSkip === compositions.length ? true : compositionSkip > 0 ? 'mixed' : false}
        title={`Leave out of the ${board.name} export`}
        onclick={() => project.edit(compositions, { skip: compositionSkip < compositions.length })}
      />
    </footer>
  {:else}
    <div class="insp-body">
      {#if slotKey && slotCell}
        <Row label="Shows" overridden={false} onReset={() => {}}>
          <div class="shows">
            <span class="shows-name" title={slotAsset?.name}>{slotAsset?.label ?? 'Nothing yet'}</span>
            <Button icon="replace" iconSize={14} onclick={() => (shell.choosing = slotCell.slot.id)}>{slotAsset ? 'Replace' : 'Choose'}</Button>
          </div>
        </Row>
        {#if slotAsset?.kind === 'video'}
          <Row label="When shorter than the composition" overridden={slotCell.slot.end === 'hold'} onReset={() => setSlot(slotCell.slot.id, { end: 'loop' })}>
            <Segmented
              value={slotCell.slot.end ?? 'loop'}
              options={[
                { value: 'loop', label: 'Loop', title: 'Play again from the start of its trim' },
                { value: 'hold', label: 'Hold', title: 'Stay on its last frame' }
              ]}
              onChange={(end) => setSlot(slotCell.slot.id, { end })}
            />
          </Row>
        {/if}
      {/if}
      <Row label="Fit" {...rp(['fit'])}>
        <Segmented value={s.fit} options={FITS} onChange={(fit) => edit({ fit })} />
      </Row>

      <Row label="Position" {...rp(['anchorX', 'anchorY', 'offsetX', 'offsetY'])}>
        <div class="position">
          <AnchorGrid x={s.anchorX} y={s.anchorY} onChange={(anchorX, anchorY) => edit({ anchorX, anchorY, offsetX: 0, offsetY: 0 })} />
          <div class="xy">
            <NumberField label="X" value={s.offsetX * W} step={1} onChange={(v) => edit({ offsetX: v / W })} onReset={back('offsetX')} />
            <NumberField label="Y" value={s.offsetY * H} step={1} onChange={(v) => edit({ offsetY: v / H })} onReset={back('offsetY')} />
          </div>
        </div>
      </Row>

      <Row label="Transform" {...rp(['zoom', 'scaleX', 'scaleY', 'rotation', 'flipX', 'flipY'])}>
        <div class="pair">
          <NumberField
            label="Scale"
            value={s.zoom * 100}
            step={1}
            min={ZOOM_MIN * 100}
            max={ZOOM_MAX * 100}
            suffix="%"
            onChange={(v) => edit({ zoom: v / 100 })}
            onReset={back('zoom')}
          />
          <NumberField
            label="Angle"
            value={s.rotation}
            step={0.1}
            min={-180}
            max={180}
            suffix="°"
            onChange={(v) => edit({ rotation: normDeg(v) })}
            onReset={back('rotation')}
          />
        </div>
        <!-- Only once stretched from an edge in the single view. -->
        {#if s.scaleX !== 1 || s.scaleY !== 1}
          <div class="pair">
            <NumberField
              label="W"
              value={s.scaleX * 100}
              step={1}
              min={2}
              max={1000}
              suffix="%"
              onChange={(v) => edit({ scaleX: v / 100 })}
              onReset={back('scaleX')}
            />
            <NumberField
              label="H"
              value={s.scaleY * 100}
              step={1}
              min={2}
              max={1000}
              suffix="%"
              onChange={(v) => edit({ scaleY: v / 100 })}
              onReset={back('scaleY')}
            />
          </div>
        {/if}
        <div class="tool-grid">
          <Button variant="tool" icon="flipH" pressed={s.flipX} title="Flip horizontal" onclick={() => editEach((x) => ({ flipX: !x.flipX }))} />
          <Button variant="tool" icon="flipV" pressed={s.flipY} title="Flip vertical" onclick={() => editEach((x) => ({ flipY: !x.flipY }))} />
          <Button variant="tool" icon="rotateL" title="Rotate left" onclick={() => editEach((x) => ({ rotation: normDeg(x.rotation - 90) }))} />
          <Button variant="tool" icon="rotateR" title="Rotate right" onclick={() => editEach((x) => ({ rotation: normDeg(x.rotation + 90) }))} />
        </div>
      </Row>

      <Row label="Background" {...rp(['bg', 'bgColor', 'blur'])}>
        <Segmented
          value={s.bg}
          options={[
            { value: 'color', label: 'Color' },
            { value: 'blur', label: 'Blur', title: 'Blurred copy of the media' }
          ]}
          onChange={(bg) => edit({ bg })}
        />
        {#if s.bg === 'color'}
          <ColorPicker value={s.bgColor} onChange={(bgColor) => edit({ bgColor })} onReset={back('bgColor')}>
            <Button
              variant="icon"
              icon="pipette"
              tone={shell.picking ? 'accent' : undefined}
              title={`Pick from media (${hint(GLOBAL.actions.pick)})`}
              onclick={pickBackground}
            />
          </ColorPicker>
        {:else}
          <div class="slider-row">
            <Slider value={s.blur} min={0} max={200} step={1} curve={1.6} onChange={(blur) => edit({ blur })} onReset={back('blur')} />
            <NumberField value={s.blur} step={1} min={0} max={400} width={64} onChange={(blur) => edit({ blur })} onReset={back('blur')} />
          </div>
        {/if}
      </Row>

      {#if hasVideo && !slotKey}
        <Row label="Mute audio" {...rp(['mute'])}>
          <Toggle value={s.mute} onChange={(mute) => edit({ mute })} />
        </Row>
      {/if}
      <!-- A cell's place in its composition. -->
      {#if slotKey}{@render structure()}{/if}
    </div>

    {#if editing}
      <footer class="insp-foot">
        <Button icon="reset" iconSize={14} disabled={!anyOverride} title={`Reset to defaults (${hint(GLOBAL.actions.reset)})`} onclick={resetSelection}
          >Reset</Button
        >
        <div class="spacer"></div>
        <!-- Whether the selection is left out of this artboard's export. Not a framing setting, so it
           sits apart from them; Reset leaves it alone. (A cell isn't exported on its own.) -->
        {#if !slotKey}<Button
            variant="icon"
            icon="leaveOut"
            iconSize={14}
            tone="danger"
            pressed={exported === 0 ? true : mixedExport ? 'mixed' : false}
            title={`Leave out of the ${board.name} export`}
            onclick={() => edit({ skip: exported > 0 })}
          />{/if}
        <Button variant="icon" icon="copy" iconSize={14} title={`Copy settings (${hint(GLOBAL.actions.copy)})`} onclick={copy} disabled={!selection.focus} />
        <Button
          variant="icon"
          icon="paste"
          iconSize={14}
          title={`Paste settings (${hint(GLOBAL.actions.paste)})`}
          onclick={paste}
          disabled={!project.clipboard}
        />
      </footer>
    {/if}
  {/if}
</aside>

<style>
  .inspector {
    display: flex;
    flex-direction: column;
    background: var(--panel);
    border-left: 1px solid var(--line);
    min-height: 0;
  }

  .insp-head {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px 16px 14px;
    border-bottom: 1px solid var(--line);
  }

  /* Breadcrumb: the artboard's defaults are the parent of whatever is selected. */
  .crumbs {
    display: flex;
    align-items: center;
    gap: 2px;
    min-width: 0;
    margin-left: -6px;
    font-size: 13px;
    font-weight: 600;
  }

  .crumb {
    flex: none;
    max-width: 100%;
    padding: 3px 6px;
    border-radius: 6px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--muted);
    transition:
      background-color var(--t-fast) var(--ease),
      color var(--t-fast) var(--ease);
  }

  .muted-crumb {
    color: var(--faint);
  }

  .crumb-rename {
    flex: 1;
    min-width: 0;
    height: 24px;
    padding: 0 6px;
    border: 0;
    border-radius: 6px;
    outline: 0;
    background: var(--tint-2);
    box-shadow: 0 0 0 1px var(--accent);
    color: var(--text);
    font: inherit;
  }

  .shows {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .shows-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* The asset crumb takes the remaining width and truncates; the artboard crumb keeps its size. */
  .crumb.current {
    flex: 0 1 auto;
    color: var(--text);
  }

  button.crumb:hover {
    color: var(--text);
    background: var(--tint-2);
  }

  .crumb-sep {
    flex: none;
    display: grid;
    place-items: center;
    color: var(--faint);
  }

  .tags {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  .insp-body {
    flex: 1;
    overflow-y: auto;
    padding: 6px 0;
  }

  .position {
    display: flex;
    gap: 8px;
  }

  .xy {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .pair {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }

  /* Four separate buttons; with the same 8px gap, columns 1–2 sit under Scale and 3–4 under Angle. */
  .tool-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 8px;
  }

  .slider-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .insp-foot {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 10px 12px;
    border-top: 1px solid var(--line);
  }
</style>
