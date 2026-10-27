<!--
  A bento composition's selected group: which way its cells run (or Auto, following each artboard's
  shape; or the same way as the group around it), making them equal, and ungrouping it. Takes props;
  the inspector connects it.
-->
<script lang="ts">
  import type { Dir } from '@shared/composition/bento'
  import type { Split } from '@shared/types'
  import { COMPOSITION_EDITOR } from '../../config/keymaps'
  import { hint } from '../../lib/keymap.svelte'
  import { Button, Segmented } from '../../ui'
  import Row from './Row.svelte'

  let {
    group,
    nested,
    onDir,
    onEvenOut,
    onUngroup
  }: {
    group: Split
    /** It's inside another group (so it can run the same way as that one). */
    nested: boolean
    onDir: (group: string, dir: Dir | 'same' | null) => void
    onEvenOut: (group: string) => void
    /** Its cells spread into the group around it (only given if it's inside one). */
    onUngroup?: (group: string) => void
  } = $props()
</script>

<Row label="Direction" overridden={false} onReset={() => {}}>
  <Segmented
    value={group.dir ?? 'auto'}
    options={[
      { value: 'row', label: 'Horizontal', title: 'A horizontal stack, on every artboard' },
      { value: 'col', label: 'Vertical', title: 'A vertical stack, on every artboard' },
      { value: 'auto', label: 'Auto', title: "Whichever suits each artboard's shape" },
      ...(nested || group.dir === 'same' ? [{ value: 'same', label: 'Same', title: 'The same way as the group around it, whichever way that runs' }] : [])
    ]}
    onChange={(v) => onDir(group.id, v === 'auto' ? null : (v as Dir | 'same'))}
  />
  <div class="actions">
    <Button icon="evenOut" iconSize={14} onclick={() => onEvenOut(group.id)}>Make cells equal</Button>
    {#if onUngroup}
      <Button
        icon="ungroup"
        iconSize={14}
        title={`Spread its cells into the group around it (${hint(COMPOSITION_EDITOR.actions.ungroup)})`}
        onclick={() => onUngroup(group.id)}>Ungroup</Button
      >
    {/if}
  </div>
</Row>

<style>
  .actions {
    display: flex;
    gap: 4px;
  }
</style>
