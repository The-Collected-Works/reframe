<!-- The + after the tabs: a new artboard from a preset size, or a custom one (opening its editor). -->
<script lang="ts">
  import { app } from '../../state/app.svelte'
  import { PRESETS } from '../../state/project'
  import Icon from '../../ui/Icon.svelte'
  import Popover from '../../ui/Popover.svelte'

  let open = $state(false)
  const add = (name: string, width: number, height: number) => {
    app.addBoard(name, width, height)
    open = false
  }
</script>

<div class="anchor">
  <button class="icon-btn" title="Add artboard" onclick={() => (open = !open)}>
    <Icon name="plus" size={14} />
  </button>
  <Popover {open} onClose={() => (open = false)}>
    {#each PRESETS as p (p.name)}
      <button class="menu-item" onclick={() => add(p.name, p.width, p.height)}>
        <span>{p.name}</span>
        <span class="muted">{p.width}×{p.height}</span>
      </button>
    {/each}
    <div class="menu-sep"></div>
    <button
      class="menu-item"
      onclick={() => {
        add('Custom', 1200, 1200)
        app.setBoardEditor(app.boardId)
      }}
    >
      Custom…
    </button>
  </Popover>
</div>

<style>
  .anchor {
    position: relative;
  }
</style>
