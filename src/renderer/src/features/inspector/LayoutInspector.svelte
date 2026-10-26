<!--
  A layout's own settings: the spacing around and between its cells, their corners, the background,
  how long it runs, and whether this artboard's arrangement has been changed from the automatic
  one. Takes props; the inspector connects it.
-->
<script lang="ts">
  import type { LayoutItem } from '@shared/types'
  import { fmtTime } from '../../lib/format'
  import { Button, ColorPicker, NumberField, Segmented, Slider } from '../../ui'
  import Row from './Row.svelte'

  let {
    layout,
    boardName,
    arranged,
    longest,
    picking,
    pickHint,
    onEdit,
    onResetArrangement,
    onPick
  }: {
    layout: LayoutItem
    boardName: string
    /** This artboard's arrangement has been changed (dividers dragged, directions set). */
    arranged: boolean
    /** Its longest video's length; 0 with no video. */
    longest: number
    picking: boolean
    pickHint: string
    onEdit: (patch: Partial<LayoutItem>) => void
    onResetArrangement: () => void
    onPick: () => void
  } = $props()

  const DEFAULTS = { gap: 16, padding: 16, radius: 0 }
</script>

<Row label="Spacing" overridden={false} onReset={() => {}}>
  <div class="pair">
    <NumberField label="Gap" value={layout.gap} step={1} min={0} max={400} onChange={(gap) => onEdit({ gap })} onReset={() => onEdit({ gap: DEFAULTS.gap })} />
    <NumberField
      label="Edge"
      value={layout.padding}
      step={1}
      min={0}
      max={400}
      onChange={(padding) => onEdit({ padding })}
      onReset={() => onEdit({ padding: DEFAULTS.padding })}
    />
  </div>
</Row>

<Row label="Corners" overridden={false} onReset={() => {}}>
  <div class="slider-row">
    <Slider value={layout.radius} min={0} max={200} step={1} curve={1.6} onChange={(radius) => onEdit({ radius })} onReset={() => onEdit({ radius: 0 })} />
    <NumberField value={layout.radius} step={1} min={0} max={1000} width={64} onChange={(radius) => onEdit({ radius })} onReset={() => onEdit({ radius: 0 })} />
  </div>
</Row>

<Row label="Background" overridden={false} onReset={() => {}}>
  <ColorPicker value={layout.bgColor} onChange={(bgColor) => onEdit({ bgColor })}>
    <Button variant="icon" icon="pipette" tone={picking ? 'accent' : undefined} title={`Pick from media (${pickHint})`} onclick={onPick} />
  </ColorPicker>
</Row>

<Row label={`Arrangement on ${boardName}`} overridden={arranged} onReset={onResetArrangement}>
  <p class="note">
    {arranged ? 'Arranged by hand here. Other artboards keep their own.' : 'Follows the artboard’s shape. Drag the gaps between cells to change it here.'}
  </p>
</Row>

{#if longest > 0}
  <Row label="Duration" overridden={layout.duration != null} onReset={() => onEdit({ duration: null })}>
    <Segmented
      value={layout.duration == null ? 'auto' : 'set'}
      options={[
        { value: 'auto', label: `Longest · ${fmtTime(longest)}`, title: 'As long as its longest video' },
        { value: 'set', label: 'Set', title: 'A length of your choosing; shorter videos loop or hold' }
      ]}
      onChange={(v) => onEdit({ duration: v === 'auto' ? null : Math.round(longest) || 1 })}
    />
    {#if layout.duration != null}
      <NumberField
        label="Seconds"
        value={layout.duration}
        step={0.1}
        min={0.1}
        max={600}
        suffix="s"
        onChange={(duration) => onEdit({ duration })}
        onReset={() => onEdit({ duration: null })}
      />
    {/if}
  </Row>
{/if}

<style>
  .pair {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }

  .slider-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .note {
    margin: 0;
    color: var(--faint);
    font-size: 11px;
    line-height: 1.5;
  }
</style>
