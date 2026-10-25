<script lang="ts">
  import type { Artboard } from '@shared/types'
  import { deleteBoard } from '../menus'
  import { app, PRESETS } from '../store.svelte'
  import Icon from '../ui/Icon.svelte'
  import NumberField from '../ui/NumberField.svelte'
  import Popover from '../ui/Popover.svelte'

  let { board, open, canDelete }: { board: Artboard; open: boolean; canDelete: boolean } = $props()
  const size = (n: number) => Math.max(16, Math.min(8192, Math.round(n)))
</script>

<Popover {open} onClose={() => app.setBoardEditor(null)} class="board-editor">
  <input
    class="text"
    value={board.name}
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
</Popover>
