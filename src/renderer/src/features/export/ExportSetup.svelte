<!-- What to export and how: where to, which artboards, which assets, and image and video formats. -->
<script lang="ts">
  import type { Artboard, ExportPrefs, GifDither } from '@shared/types'
  import type { ExportScope as Scope } from '../../state/shell.svelte'
  import { Button, Checkbox, Field, Segmented, Slider } from '../../ui'

  let {
    out,
    artboards,
    current,
    included,
    scope,
    counts,
    prefs,
    images,
    videos,
    onChooseDir,
    onToggleBoard,
    onScope,
    onPrefs
  }: {
    /** The export folder. */
    out: string
    artboards: Artboard[]
    /** The current artboard's id. */
    current: string
    /** The ids of the artboards to export. */
    included: Set<string>
    scope: Scope
    /** How many assets each scope covers (a scope with no difference isn't offered). */
    counts: { all: number; visible: number; selected: number }
    prefs: ExportPrefs
    /** Whether any images and videos are going: their settings show only then. */
    images: boolean
    videos: boolean
    onChooseDir: () => void
    onToggleBoard: (id: string, on: boolean) => void
    onScope: (scope: Scope) => void
    onPrefs: (patch: Partial<ExportPrefs>) => void
  } = $props()

  const QUALITY: { value: string; label: string; crf: number }[] = [
    { value: 'high', label: 'High', crf: 16 },
    { value: 'medium', label: 'Medium', crf: 20 },
    { value: 'small', label: 'Small', crf: 26 }
  ]
  // Email is usually 600 wide; fewer pixels and frames make a much smaller GIF.
  const GIF_WIDTHS = [400, 600, 800]
  const GIF_FPS = [10, 15, 24]
  // Fewer colours is the surest saving; dithering hides the bands that leaves, for a little size.
  const GIF_COLORS = [256, 128, 64, 32]
  const GIF_DITHER: { value: GifDither; label: string; title: string }[] = [
    { value: 'none', label: 'None', title: 'Flat colours: smallest, but gradients show bands' },
    { value: 'light', label: 'Light', title: 'A fine pattern softens bands in gradients' },
    { value: 'strong', label: 'Strong', title: 'Smoothest gradients with few colours, with a visible pattern' }
  ]
  const crfKey = $derived(QUALITY.reduce((best, q) => (Math.abs(q.crf - prefs.videoCrf) < Math.abs(best.crf - prefs.videoCrf) ? q : best)).value)
</script>

<Field label="Destination">
  <div class="dest">
    <span class="path" title={out}><bdi>{out}</bdi></span>
    <Button onclick={onChooseDir}>Change</Button>
  </div>
</Field>

<Field label="Artboards">
  <div class="checks">
    {#each artboards as b (b.id)}
      <Checkbox checked={included.has(b.id)} onChange={(on) => onToggleBoard(b.id, on)}>
        <span>{b.name}</span>
        <span class="muted">{b.width}×{b.height}</span>
        {#if b.id === current}<span class="muted small">current</span>{/if}
      </Checkbox>
    {/each}
  </div>
</Field>

{#if counts.selected > 0 || counts.visible < counts.all}
  <Field label="Assets">
    <Segmented
      value={scope}
      options={[
        { value: 'all' as const, label: `All ${counts.all}` },
        ...(counts.visible < counts.all ? [{ value: 'visible' as const, label: `Visible ${counts.visible}`, title: 'What the grid shows' }] : []),
        ...(counts.selected > 0 ? [{ value: 'selected' as const, label: `Selected ${counts.selected}` }] : [])
      ]}
      onChange={onScope}
    />
  </Field>
{/if}

{#if images}
  <Field label="Images">
    <div class="inline">
      <Segmented
        value={prefs.imageFormat}
        options={[
          { value: 'png', label: 'PNG' },
          { value: 'jpg', label: 'JPG' },
          { value: 'webp', label: 'WebP' }
        ]}
        onChange={(imageFormat) => onPrefs({ imageFormat })}
      />
      {#if prefs.imageFormat !== 'png'}
        <div class="slider-row">
          <Slider value={prefs.imageQuality * 100} min={50} max={100} step={1} onChange={(v) => onPrefs({ imageQuality: v / 100 })} />
          <span class="muted tabular">{Math.round(prefs.imageQuality * 100)}</span>
        </div>
      {/if}
    </div>
  </Field>
{/if}

{#if videos}
  <Field label="Videos">
    <div class="inline">
      <Segmented
        value={prefs.videoFormat}
        options={[
          { value: 'mp4', label: 'MP4' },
          { value: 'gif', label: 'GIF', title: 'Silent, looping and smaller: for email and the web' }
        ]}
        onChange={(videoFormat) => onPrefs({ videoFormat })}
      />
      {#if prefs.videoFormat === 'mp4'}
        <Segmented
          value={crfKey}
          options={QUALITY.map((q) => ({ value: q.value, label: q.label }))}
          onChange={(v) => onPrefs({ videoCrf: QUALITY.find((q) => q.value === v)!.crf })}
        />
      {/if}
    </div>
  </Field>
  {#if prefs.videoFormat === 'gif'}
    <Field label="GIF width and frame rate">
      <div class="inline">
        <Segmented
          value={String(prefs.gifWidth)}
          options={[...GIF_WIDTHS.map((w) => ({ value: String(w), label: String(w) })), { value: '0', label: 'Full', title: 'As wide as the artboard' }]}
          onChange={(w) => onPrefs({ gifWidth: Number(w) })}
        />
        <Segmented
          value={String(prefs.gifFps)}
          options={GIF_FPS.map((f) => ({ value: String(f), label: `${f} fps` }))}
          onChange={(f) => onPrefs({ gifFps: Number(f) })}
        />
      </div>
    </Field>
    <Field label="GIF colours and dithering">
      <div class="inline">
        <Segmented
          value={String(prefs.gifColors)}
          options={GIF_COLORS.map((c) => ({ value: String(c), label: String(c) }))}
          onChange={(c) => onPrefs({ gifColors: Number(c) })}
        />
        <Segmented value={prefs.gifDither} options={GIF_DITHER} onChange={(gifDither) => onPrefs({ gifDither })} />
      </div>
      <Checkbox checked={prefs.gifDenoise} onChange={(gifDenoise) => onPrefs({ gifDenoise })}>
        <span>Reduce grain</span>
        <span class="muted small">Much smaller from filmed footage</span>
      </Checkbox>
    </Field>
  {/if}
{/if}

<style>
  .dest {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 36px;
    padding: 0 4px 0 10px;
    background: var(--tint-1);
    border-radius: var(--radius);
  }

  /* Long paths keep their end (the folder names that matter) and lose their start. */
  .path {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    direction: rtl;
    text-align: left;
  }

  .checks {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .inline {
    display: flex;
    align-items: center;
    gap: 14px;
  }

  .inline > :global(.seg) {
    flex: none;
  }

  .slider-row {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 8px;
  }
</style>
