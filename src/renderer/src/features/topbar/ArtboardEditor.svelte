<!--
  An artboard's settings, in a popover under its tab: name, size (or a preset size), duplicate and
  delete. It opens ready to rename: the name focused and selected. Enter or clicking away keeps a
  new name; Esc closes without it.
-->
<script lang="ts">
  import type { Artboard } from '@shared/types'
  import { PRESETS } from '../../state/model/project'
  import { Button, MenuSeparator, NumberField, Popover, TextField } from '../../ui'

  type Patch = Partial<Pick<Artboard, 'name' | 'width' | 'height'>>
  let {
    board,
    open,
    canDelete,
    onClose,
    onChange,
    onDuplicate,
    onDelete
  }: {
    board: Artboard
    open: boolean
    canDelete: boolean
    onClose: () => void
    onChange: (patch: Patch) => void
    onDuplicate: () => void
    onDelete: () => void
  } = $props()

  const size = (n: number) => Math.max(16, Math.min(8192, Math.round(n)))

  // Focused once the popover is placed (it's hidden, so can't take focus, until then).
  let nameInput: HTMLInputElement | undefined
  const nameField = (input: HTMLInputElement) => {
    nameInput = input
    const raf = requestAnimationFrame(() => input.focus())
    return () => cancelAnimationFrame(raf)
  }
  // Ahead of the popover's own Esc (which closes it): put the name back, so the blur as it closes
  // changes nothing.
  function onkeydowncapture(e: KeyboardEvent) {
    if (open && e.key === 'Escape' && nameInput) nameInput.value = board.name
  }
  function rename(e: FocusEvent) {
    const name = (e.currentTarget as HTMLInputElement).value.trim()
    if (name) onChange({ name })
  }
</script>

<svelte:window {onkeydowncapture} />

<Popover {open} {onClose} padding={10}>
  <div class="editor">
    <TextField
      value={board.name}
      {@attach nameField}
      onfocus={(e) => e.currentTarget.select()}
      onblur={rename}
      onkeydown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
    />
    <div class="wh">
      <NumberField label="W" value={board.width} min={16} max={8192} onChange={(v) => onChange({ width: size(v) })} />
      <Button variant="icon" title="Swap" onclick={() => onChange({ width: board.height, height: board.width })}>⇄</Button>
      <NumberField label="H" value={board.height} min={16} max={8192} onChange={(v) => onChange({ height: size(v) })} />
    </div>
    <div class="presets">
      {#each PRESETS as p (p.name)}
        <Button variant="chip" pressed={p.width === board.width && p.height === board.height} onclick={() => onChange({ width: p.width, height: p.height })}>
          {p.width}×{p.height}
        </Button>
      {/each}
    </div>
    <MenuSeparator bleed={10} gap={2} />
    <div class="editor-actions">
      <Button icon="duplicate" iconSize={14} onclick={onDuplicate}>Duplicate</Button>
      {#if canDelete}<Button icon="trash" iconSize={14} tone="danger" onclick={onDelete}>Delete</Button>{/if}
    </div>
  </div>
</Popover>

<style>
  .editor {
    width: 240px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .wh {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .wh > :global(.num) {
    flex: 1;
  }

  .presets {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  .editor-actions {
    display: flex;
    justify-content: space-between;
    margin: 0 -4px -4px;
  }
</style>
