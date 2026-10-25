<script lang="ts">
  import { DEFAULT_SETTINGS, normDeg, resolveSettings } from '@shared/layout'
  import type { CropSettings, FitMode, SettingKey } from '@shared/types'
  import { fmtTime } from '../format'
  import { ZOOM_MAX, ZOOM_MIN } from '../interact'
  import { combo, MOD, SHIFT } from '../keys'
  import { pickBackground } from '../media'
  import { resetSelection } from '../menus'
  import { app, baseName, hasOverrides, type Asset } from '../store.svelte'
  import ColorField from '../ui/ColorField.svelte'
  import Icon from '../ui/Icon.svelte'
  import NumberField from '../ui/NumberField.svelte'
  import Segmented from '../ui/Segmented.svelte'
  import Slider from '../ui/Slider.svelte'
  import Toggle from '../ui/Toggle.svelte'
  import AnchorGrid from './AnchorGrid.svelte'
  import Row from './Row.svelte'

  const FITS: { value: FitMode; label: string; title: string }[] = [
    { value: 'fill', label: 'Fill', title: 'Cover the artboard' },
    { value: 'fit', label: 'Fit', title: 'Fit inside the artboard' },
    { value: 'width', label: 'W', title: 'Fit width' },
    { value: 'height', label: 'H', title: 'Fit height' },
    { value: 'stretch', label: 'Stretch', title: 'Stretch to fill' }
  ]

  const board = $derived(app.board)
  const selection = $derived(app.selection)
  const editing = $derived(selection.length > 0)
  const primary = $derived(editing ? (app.focus && app.selected.has(app.focus) ? app.focus : selection[0]) : null)
  const primaryAsset = $derived(selection.length === 1 ? app.asset(primary) : undefined)
  // The selected assets, found in one pass (selections can be the whole folder).
  const chosen = $derived(app.assets.filter((a) => app.selected.has(a.name)))
  const s: CropSettings = $derived(primary ? resolveSettings(board, primary) : board.defaults)
  const W = $derived(board.width)
  const H = $derived(board.height)

  const overridden = (keys: SettingKey[]) => editing && selection.some((n) => keys.some((k) => board.overrides[n]?.[k] !== undefined))
  const hasVideo = $derived((editing ? chosen : app.assets).some((a) => a.kind === 'video'))
  const anyOverride = $derived(editing && selection.some((n) => hasOverrides(board, n)))

  const rp = (keys: SettingKey[]) => ({
    overridden: overridden(keys),
    onReset: () => app.resetKeys(keys),
    onMakeDefault: () => app.makeDefault(keys)
  })

  // Middle-click on a field: an asset drops that override and follows the artboard again; the
  // artboard's own defaults go back to the built-in values.
  const back =
    (...keys: SettingKey[]) =>
    () =>
      editing ? app.resetKeys(keys) : app.edit(Object.fromEntries(keys.map((k) => [k, DEFAULT_SETTINGS[k]])) as Partial<CropSettings>)

  const fmtSize = (bytes: number) =>
    bytes >= 1e9
      ? `${(bytes / 1e9).toFixed(1)} GB`
      : bytes >= 1e6
        ? `${(bytes / 1e6).toFixed(bytes >= 1e8 ? 0 : 1)} MB`
        : `${Math.max(1, Math.round(bytes / 1e3))} KB`
  const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`

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

  const title = $derived(selection.length === 1 ? baseName(primary!) : `${selection.length} assets`)
  const tags = $derived(
    !editing
      ? [
          `${board.width}×${board.height}`,
          plural(app.assets.length, 'asset'),
          plural(app.assets.filter((a) => hasOverrides(board, a.name)).length, 'adjusted', 'adjusted')
        ]
      : selection.length === 1 && primaryAsset
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
        <button class="crumb" title="Edit the defaults every asset follows (Esc)" onclick={() => app.clearSelection()}>{board.name}</button>
        <span class="crumb-sep"><Icon name="next" size={12} /></span>
        <span class="crumb current" title={selection.length === 1 ? primary! : title}>{title}</span>
      {:else}
        <span class="crumb current">{board.name}</span>
      {/if}
    </nav>
    <div class="tags">
      {#each tags as t (t)}<span class="tag">{t}</span>{/each}
    </div>
  </header>

  <div class="insp-body">
    <Row label="Fit" {...rp(['fit'])}>
      <Segmented value={s.fit} options={FITS} onChange={(fit) => app.edit({ fit })} />
    </Row>

    <Row label="Position" {...rp(['anchorX', 'anchorY', 'offsetX', 'offsetY'])}>
      <div class="position">
        <AnchorGrid x={s.anchorX} y={s.anchorY} onChange={(anchorX, anchorY) => app.edit({ anchorX, anchorY, offsetX: 0, offsetY: 0 })} />
        <div class="xy">
          <NumberField label="X" value={s.offsetX * W} step={1} onChange={(v) => app.edit({ offsetX: v / W })} onReset={back('offsetX')} />
          <NumberField label="Y" value={s.offsetY * H} step={1} onChange={(v) => app.edit({ offsetY: v / H })} onReset={back('offsetY')} />
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
          onChange={(v) => app.edit({ zoom: v / 100 })}
          onReset={back('zoom')}
        />
        <NumberField
          label="Angle"
          value={s.rotation}
          step={0.1}
          min={-180}
          max={180}
          suffix="°"
          onChange={(v) => app.edit({ rotation: normDeg(v) })}
          onReset={back('rotation')}
        />
      </div>
      <!-- Only once stretched from an edge in the single view. -->
      {#if s.scaleX !== 1 || s.scaleY !== 1}
        <div class="pair">
          <NumberField label="W" value={s.scaleX * 100} step={1} min={2} max={1000} suffix="%" onChange={(v) => app.edit({ scaleX: v / 100 })} onReset={back('scaleX')} />
          <NumberField label="H" value={s.scaleY * 100} step={1} min={2} max={1000} suffix="%" onChange={(v) => app.edit({ scaleY: v / 100 })} onReset={back('scaleY')} />
        </div>
      {/if}
      <div class="tool-grid">
        <button class={'tool' + (s.flipX ? ' on' : '')} title="Flip horizontal" onclick={() => app.editEach((x) => ({ flipX: !x.flipX }))}>
          <Icon name="flipH" />
        </button>
        <button class={'tool' + (s.flipY ? ' on' : '')} title="Flip vertical" onclick={() => app.editEach((x) => ({ flipY: !x.flipY }))}>
          <Icon name="flipV" />
        </button>
        <button class="tool" title="Rotate left" onclick={() => app.editEach((x) => ({ rotation: normDeg(x.rotation - 90) }))}>
          <Icon name="rotateL" />
        </button>
        <button class="tool" title="Rotate right" onclick={() => app.editEach((x) => ({ rotation: normDeg(x.rotation + 90) }))}>
          <Icon name="rotateR" />
        </button>
      </div>
    </Row>

    <Row label="Background" {...rp(['bg', 'bgColor', 'blur'])}>
      <Segmented
        value={s.bg}
        options={[
          { value: 'color', label: 'Color' },
          { value: 'blur', label: 'Blur', title: 'Blurred copy of the media' }
        ]}
        onChange={(bg) => app.edit({ bg })}
      />
      {#if s.bg === 'color'}
        <div class="color-row">
          <ColorField value={s.bgColor} onChange={(bgColor) => app.edit({ bgColor })} onReset={back('bgColor')} />
          <button class={'icon-btn' + (app.picking ? ' armed' : '')} title="Pick from media (I)" onclick={pickBackground}>
            <Icon name="pipette" />
          </button>
        </div>
      {:else}
        <div class="slider-row">
          <Slider value={s.blur} min={0} max={200} step={1} curve={1.6} onChange={(blur) => app.edit({ blur })} onReset={back('blur')} />
          <NumberField value={s.blur} step={1} min={0} max={400} width={64} onChange={(blur) => app.edit({ blur })} onReset={back('blur')} />
        </div>
      {/if}
    </Row>

    {#if hasVideo}
      <Row label="Mute audio" {...rp(['mute'])}>
        <Toggle value={s.mute} onChange={(mute) => app.edit({ mute })} />
      </Row>
    {/if}

    {#if editing}
      <Row label="Include in export" {...rp(['skip'])}>
        <Toggle value={!s.skip} onChange={(v) => app.edit({ skip: !v })} />
      </Row>
    {/if}
  </div>

  {#if editing}
    <footer class="insp-foot">
      <button class="ghost" disabled={!anyOverride} title={`Reset to defaults (${combo(MOD, SHIFT, 'R')})`} onclick={resetSelection}>
        <Icon name="reset" size={14} /> Reset
      </button>
      <div class="spacer"></div>
      <button class="icon-btn" title={`Copy settings (${combo(MOD, 'C')})`} onclick={() => app.copy()} disabled={!app.focus}>
        <Icon name="copy" size={14} />
      </button>
      <button class="icon-btn" title={`Paste settings (${combo(MOD, 'V')})`} onclick={() => app.paste()} disabled={!app.clipboard}>
        <Icon name="paste" size={14} />
      </button>
    </footer>
  {/if}
</aside>
