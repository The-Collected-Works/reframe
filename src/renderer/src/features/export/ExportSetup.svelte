<!-- What to export and how: where to, which artboards, which assets, and image and video quality. -->
<script lang="ts">
  import type { Artboard, ExportPrefs } from '@shared/types'
  import { Button, Checkbox, Field, Segmented, Slider } from '../../ui'

  export type Scope = 'all' | 'visible' | 'selected'

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
  <Field label="Video · MP4">
    <Segmented
      value={crfKey}
      options={QUALITY.map((q) => ({ value: q.value, label: q.label }))}
      onChange={(v) => onPrefs({ videoCrf: QUALITY.find((q) => q.value === v)!.crf })}
    />
  </Field>
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
