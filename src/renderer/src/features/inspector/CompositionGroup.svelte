<!--
  A bento composition's selected group: which way its cells run (or Auto, following each artboard's
  shape; or the same way as the group around it), and making them equal. Takes props; the inspector connects it.
-->
<script lang="ts">
  import type { Dir } from '@shared/composition/bento'
  import type { Split } from '@shared/types'
  import { Button, Segmented } from '../../ui'
  import Row from './Row.svelte'

  let {
    group,
    nested,
    onDir,
    onEvenOut
  }: {
    group: Split
    /** It's inside another group (so it can run the same way as that one). */
    nested: boolean
    onDir: (group: string, dir: Dir | 'same' | null) => void
    onEvenOut: (group: string) => void
  } = $props()
</script>

<Row label="Group" overridden={false} onReset={() => {}}>
  <Segmented
    value={group.dir ?? 'auto'}
    options={[
      { value: 'row', label: 'Side by side', title: 'Its cells side by side, on every artboard' },
      { value: 'col', label: 'Stacked', title: 'Its cells stacked, on every artboard' },
      { value: 'auto', label: 'Auto', title: "Whichever suits each artboard's shape" },
      ...(nested || group.dir === 'same' ? [{ value: 'same', label: 'Same', title: 'The same way as the group around it, whichever way that runs' }] : [])
    ]}
    onChange={(v) => onDir(group.id, v === 'auto' ? null : (v as Dir | 'same'))}
  />
  <Button icon="evenOut" iconSize={14} onclick={() => onEvenOut(group.id)}>Make cells equal</Button>
</Row>
