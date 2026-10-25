<script lang="ts">
  import type { Artboard } from '@shared/types'
  import { deleteBoard } from '../../state/actions'
  import { app } from '../../state/app.svelte'
  import { PRESETS } from '../../state/project'
  import Icon from '../../ui/Icon.svelte'
  import NumberField from '../../ui/NumberField.svelte'
  import Popover from '../../ui/Popover.svelte'

  let { board, open, canDelete }: { board: Artboard; open: boolean; canDelete: boolean } = $props()
  const size = (n: number) => Math.max(16, Math.min(8192, Math.round(n)))
  // Opens ready to rename: the name focused and selected, once the popover is placed (it's hidden,
  // so can't take focus, until then). Enter or clicking away keeps the new name; Esc closes
  // without it.
  let nameInput: HTMLInputElement
  const focusName = (input: HTMLInputElement) => {
    const raf = requestAnimationFrame(() => input.focus())
    return () => cancelAnimationFrame(raf)
  }
  // Ahead of the popover's own Esc (which closes it): put the name back, so the blur as it closes
  // changes nothing.
  function onkeydowncapture(e: KeyboardEvent) {
    if (open && e.key === 'Escape' && nameInput) nameInput.value = board.name
  }
</script>

<svelte:window {onkeydowncapture} />

<Popover {open} onClose={() => app.setBoardEditor(null)} padding={10}>
  <div class="editor">
    <input
      class="text"
      bind:this={nameInput}
      value={board.name}
      {@attach focusName}
      onfocus={(e) => e.currentTarget.select()}
      onblur={(e) => e.currentTarget.value.trim() && app.updateBoard(board.id, { name: e.currentTarget.value.trim() })}
      onkeydown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
    />
    <div class="wh">
      <NumberField label="W" value={board.width} min={16} max={8192} onChange={(v) => app.updateBoard(board.id, { width: size(v) })} />
      <button class="icon-btn" title="Swap" onclick={() => app.updateBoard(board.id, { width: board.height, height: board.width })}>⇄</button>
      <NumberField label="H" value={board.height} min={16} max={8192} onChange={(v) => app.updateBoard(board.id, { height: size(v) })} />
    </div>
    <div class="presets">
      {#each PRESETS as p (p.name)}
        <button
          class={['chip', { on: p.width === board.width && p.height === board.height }]}
          onclick={() => app.updateBoard(board.id, { width: p.width, height: p.height })}
        >
          {p.width}×{p.height}
        </button>
      {/each}
    </div>
    <div class="menu-sep"></div>
    <div class="editor-actions">
      <button class="ghost" onclick={() => app.duplicateBoard(board.id)}>
        <Icon name="duplicate" size={14} />
        Duplicate
      </button>
      {#if canDelete}
        <button class="ghost danger" onclick={() => deleteBoard(board.id)}>
          <Icon name="trash" size={14} />
          Delete
        </button>
      {/if}
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

  .text {
    height: var(--control);
    padding: 0 8px;
    border: 0;
    border-radius: 6px;
    outline: 0;
    background: var(--tint-1);
    font-weight: 500;
  }

  .text:focus {
    background: var(--tint-2);
    box-shadow: 0 0 0 1px var(--accent);
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

  .chip {
    height: 26px;
    padding: 0 8px;
    border-radius: 6px;
    background: var(--tint-1);
    color: var(--muted);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    transition:
      background-color var(--t-fast) var(--ease),
      color var(--t-fast) var(--ease),
      transform var(--t-fast) var(--ease);
  }

  .chip:hover {
    color: var(--text);
    background: var(--tint-2);
  }

  .chip.on {
    color: var(--text);
    background: var(--tint-3);
  }

  .chip:active {
    transform: scale(0.95);
  }

  .editor .menu-sep {
    margin: 2px -10px;
  }

  .editor-actions {
    display: flex;
    justify-content: space-between;
    margin: 0 -4px -4px;
  }
</style>
