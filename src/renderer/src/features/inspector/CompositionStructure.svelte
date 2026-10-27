<!--
  A bento composition's structure: its groups (side by side, or stacked) and cells as an outline.
  Click a line to select it. A selected group's direction can be set (or left Auto, following each
  artboard's shape) and its cells made equal here. Takes props; the inspector connects it.
-->
<script lang="ts">
  import { isSplit, type Dir, type DirOf } from '@shared/composition/bento'
  import type { BentoNode } from '@shared/types'
  import { Button, Icon, Segmented } from '../../ui'
  import Row from './Row.svelte'

  let {
    root,
    dirOf,
    labelOf,
    selected,
    onSelect,
    onDir,
    onEvenOut
  }: {
    root: BentoNode
    /** Which way each group runs on this artboard (Auto ones as they're placed). */
    dirOf: DirOf
    /** What a cell shows, as it's called. */
    labelOf: (slot: string) => string
    selected: string | null
    onSelect: (id: string) => void
    onDir: (group: string, dir: Dir | null) => void
    onEvenOut: (group: string) => void
  } = $props()

  type Line = { node: BentoNode; depth: number }
  const lines = $derived.by(() => {
    const out: Line[] = []
    const walk = (n: BentoNode, depth: number) => {
      out.push({ node: n, depth })
      if (isSplit(n)) n.children.forEach((c) => walk(c, depth + 1))
    }
    walk(root, 0)
    return out
  })
  const group = $derived.by(() => {
    const l = lines.find((x) => x.node.id === selected)
    return l && isSplit(l.node) ? l.node : null
  })
</script>

{#if group}
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
{/if}

<Row label="Structure" overridden={false} onReset={() => {}}>
  <div class="outline" role="tree">
    {#each lines as { node, depth } (node.id)}
      {@const split = isSplit(node)}
      <button
        class={['line', { on: node.id === selected }]}
        role="treeitem"
        aria-selected={node.id === selected}
        style:padding-left={`${8 + depth * 14}px`}
        onclick={() => onSelect(node.id)}
      >
        {#if split}
          <Icon name={dirOf(node) === 'row' ? 'splitRow' : 'splitCol'} size={13} />
          <span>{dirOf(node) === 'row' ? 'Side by side' : 'Stacked'}{node.dir ? '' : ' · Auto'}</span>
          <span class="count">{node.children.length}</span>
        {:else}
          <span class="dot"></span>
          <span class={{ empty: !node.item }}>{node.item ? labelOf(node.id) : 'Empty'}</span>
        {/if}
      </button>
    {/each}
  </div>
</Row>

<style>
  .outline {
    display: flex;
    flex-direction: column;
    gap: 1px;
    margin: 0 -8px;
  }

  .line {
    display: flex;
    align-items: center;
    gap: 7px;
    height: 26px;
    padding-right: 8px;
    border-radius: 6px;
    color: var(--muted);
    font-size: 12px;
    text-align: left;
    white-space: nowrap;
  }

  .line span {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .line:hover {
    color: var(--text);
    background: var(--tint-1);
  }

  .line.on {
    color: var(--text);
    background: var(--accent-soft);
  }

  .line :global(svg) {
    flex: none;
    color: var(--faint);
  }

  .line.on :global(svg) {
    color: var(--accent);
  }

  .count {
    margin-left: auto;
    color: var(--faint);
    font-variant-numeric: tabular-nums;
  }

  .dot {
    flex: none;
    width: 5px;
    height: 5px;
    margin: 0 4px;
    border-radius: 50%;
    background: var(--faint);
  }

  .empty {
    color: var(--faint);
    font-style: italic;
  }
</style>
