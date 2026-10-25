<!-- The + after the tabs: a new artboard from a preset size, or a custom one. -->
<script lang="ts">
  import { PRESETS } from '../../state/model/project'
  import { Button, MenuItem, MenuSeparator, Popover } from '../../ui'

  /** `custom`: a size to set yourself (its editor opens). */
  let { onAdd }: { onAdd: (name: string, width: number, height: number, custom?: boolean) => void } = $props()
  let open = $state(false)
  const add = (name: string, width: number, height: number, custom = false) => {
    onAdd(name, width, height, custom)
    open = false
  }
</script>

<div class="anchor">
  <Button variant="icon" icon="plus" iconSize={14} title="Add artboard" onclick={() => (open = !open)} />
  <Popover {open} onClose={() => (open = false)}>
    {#each PRESETS as p (p.name)}
      <MenuItem detail={`${p.width}×${p.height}`} onclick={() => add(p.name, p.width, p.height)}>{p.name}</MenuItem>
    {/each}
    <MenuSeparator />
    <MenuItem onclick={() => add('Custom', 1200, 1200, true)}>Custom…</MenuItem>
  </Popover>
</div>

<style>
  .anchor {
    position: relative;
  }
</style>
