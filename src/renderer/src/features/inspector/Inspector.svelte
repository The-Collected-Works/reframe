<!--
  The settings of the selection, or with nothing selected, the artboard's defaults that every asset
  follows. A dot beside a setting marks it as changed from the defaults (click to reset it; "Make
  default" turns it into the default). The inspector's connection to app state.
-->
<script lang="ts">
  import { DEFAULT_SETTINGS, normDeg, resolveSettings } from '@shared/layout'
  import type { CropSettings, FitMode, SettingKey } from '@shared/types'
  import { fmtSize, fmtTime, plural } from '../../lib/format'
  import { combo, MOD, SHIFT } from '../../lib/keys'
  import { clearSelection, copy, edit, editEach, makeDefault, paste, resetKeys, resetSelection } from '../../state/actions'
  import { library, type Asset } from '../../state/library.svelte'
  import { hasOverrides } from '../../state/model/project'
  import { baseName } from '../../state/model/tree'
  import { project } from '../../state/project.svelte'
  import { selection } from '../../state/selection.svelte'
  import { shell } from '../../state/shell.svelte'
  import { Button, ColorPicker, Icon, NumberField, Segmented, Slider, Tag, Toggle } from '../../ui'
  import { ZOOM_MAX, ZOOM_MIN } from '../snapping'
  import AnchorGrid from './AnchorGrid.svelte'
  import { pickBackground } from './eyedropper'
  import Row from './Row.svelte'

  const FITS: { value: FitMode; label: string; title: string }[] = [
    { value: 'fill', label: 'Fill', title: 'Cover the artboard' },
    { value: 'fit', label: 'Fit', title: 'Fit inside the artboard' },
    { value: 'width', label: 'W', title: 'Fit width' },
    { value: 'height', label: 'H', title: 'Fit height' },
    { value: 'stretch', label: 'Stretch', title: 'Stretch to fill' }
  ]

  const board = $derived(project.board)
  const names = $derived(selection.names)
  const editing = $derived(names.length > 0)
  /** The asset whose values are shown: the focused one if it's selected, else the first. */
  const primary = $derived(editing ? (selection.focus && selection.has(selection.focus) ? selection.focus : names[0]) : null)
  const primaryAsset = $derived(names.length === 1 ? library.asset(primary) : undefined)
  // The selected assets, found in one pass (selections can be the whole folder).
  const chosen = $derived(library.assets.filter((a) => selection.has(a.name)))
  const s: CropSettings = $derived(primary ? resolveSettings(board, primary) : board.defaults)
  const W = $derived(board.width)
  const H = $derived(board.height)

  const overridden = (keys: SettingKey[]) => editing && names.some((n) => keys.some((k) => board.overrides[n]?.[k] !== undefined))
  const hasVideo = $derived((editing ? chosen : library.assets).some((a) => a.kind === 'video'))
  const anyOverride = $derived(editing && names.some((n) => hasOverrides(board, n)))
  // How much of the selection goes into this artboard's export: all of it, none, or some.
  const exported = $derived(names.filter((n) => !resolveSettings(board, n).skip).length)
  const mixedExport = $derived(exported > 0 && exported < names.length)

  const rp = (keys: SettingKey[]) => ({
    overridden: overridden(keys),
    onReset: () => resetKeys(keys),
    onMakeDefault: () => makeDefault(keys)
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

  const title = $derived(names.length === 1 ? baseName(primary!) : `${names.length} assets`)
  const tags = $derived(
    !editing
      ? [
          `${board.width}×${board.height}`,
          plural(library.assets.length, 'asset'),
          plural(library.assets.filter((a) => hasOverrides(board, a.name)).length, 'adjusted', 'adjusted')
        ]
      : names.length === 1 && primaryAsset
        ? describe(primaryAsset)
        : [
            ...(chosen.some((a) => a.kind === 'video') ? [plural(chosen.filter((a) => a.kind === 'video').length, 'video')] : []),
            ...(chosen.some((a) => a.kind === 'image') ? [plural(chosen.filter((a) => a.kind === 'image').length, 'image')] : []),
            fmtSize(chosen.reduce((n, a) => n + a.size, 0))
          ]
  )
</script>

<aside class="inspector">
  <header class="insp-head">
    <!-- Breadcrumb: the artboard's defaults are the parent of whatever is selected. -->
    <nav class="crumbs">
      {#if editing}
        <button class="crumb" title="Edit the defaults every asset follows (Esc)" onclick={() => clearSelection()}>{board.name}</button>
        <span class="crumb-sep"><Icon name="next" size={12} /></span>
        <span class="crumb current" title={names.length === 1 ? primary! : title}>{title}</span>
      {:else}
        <span class="crumb current">{board.name}</span>
      {/if}
    </nav>
    <div class="tags">
      {#each tags as t (t)}<Tag>{t}</Tag>{/each}
    </div>
  </header>

  <div class="insp-body">
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
          <Button variant="icon" icon="pipette" tone={shell.picking ? 'accent' : undefined} title="Pick from media (I)" onclick={pickBackground} />
        </ColorPicker>
      {:else}
        <div class="slider-row">
          <Slider value={s.blur} min={0} max={200} step={1} curve={1.6} onChange={(blur) => edit({ blur })} onReset={back('blur')} />
          <NumberField value={s.blur} step={1} min={0} max={400} width={64} onChange={(blur) => edit({ blur })} onReset={back('blur')} />
        </div>
      {/if}
    </Row>

    {#if hasVideo}
      <Row label="Mute audio" {...rp(['mute'])}>
        <Toggle value={s.mute} onChange={(mute) => edit({ mute })} />
      </Row>
    {/if}
  </div>

  {#if editing}
    <footer class="insp-foot">
      <Button icon="reset" iconSize={14} disabled={!anyOverride} title={`Reset to defaults (${combo(MOD, SHIFT, 'R')})`} onclick={resetSelection}>Reset</Button>
      <div class="spacer"></div>
      <!-- Whether the selection is left out of this artboard's export. Not a framing setting, so it
           sits apart from them; Reset leaves it alone. -->
      <Button
        variant="icon"
        icon="leaveOut"
        iconSize={14}
        tone="danger"
        pressed={exported === 0 ? true : mixedExport ? 'mixed' : false}
        title={`Leave out of the ${board.name} export`}
        onclick={() => edit({ skip: exported > 0 })}
      />
      <Button variant="icon" icon="copy" iconSize={14} title={`Copy settings (${combo(MOD, 'C')})`} onclick={copy} disabled={!selection.focus} />
      <Button variant="icon" icon="paste" iconSize={14} title={`Paste settings (${combo(MOD, 'V')})`} onclick={paste} disabled={!project.clipboard} />
    </footer>
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
