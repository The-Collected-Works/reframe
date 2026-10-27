<!--
  A bento composition's selected group: which way its cells run (or Auto, following each artboard's
  shape), and making them equal. Takes props; the inspector connects it.
-->
<script lang="ts">
  import type { Dir } from '@shared/composition/bento'
  import type { Split } from '@shared/types'
  import { Button, Segmented } from '../../ui'
  import Row from './Row.svelte'

  let { group, onDir, onEvenOut }: { group: Split; onDir: (group: string, dir: Dir | null) => void; onEvenOut: (group: string) => void } = $props()
</script>

<Row label="Group" overridden={false} onReset={() => {}}>
  <Segmented
    value={group.dir ?? 'auto'}
    options={[
      { value: 'row', label: 'Side by side', title: 'Its cells side by side, on every artboard' },
      { value: 'col', label: 'Stacked', title: 'Its cells stacked, on every artboard' },
      { value: 'auto', label: 'Auto', title: "Whichever suits each artboard's shape" }
    ]}
    onChange={(v) => onDir(group.id, v === 'auto' ? null : (v as Dir))}
  />
  <Button icon="evenOut" iconSize={14} onclick={() => onEvenOut(group.id)}>Make cells equal</Button>
</Row>
