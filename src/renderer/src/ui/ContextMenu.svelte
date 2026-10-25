<!-- The app's own context menu: same surface as its popovers, with icons, shortcuts and checks. -->
<script lang="ts">
  import { closeMenu } from '../menus'
  import { presence } from '../presence.svelte'
  import { app, type AppMenuItem } from '../store.svelte'
  import MenuView from './MenuView.svelte'

  // The last menu stays rendered while it animates out.
  let last = $state.raw<{ x: number; y: number; items: AppMenuItem[] } | null>(null)
  $effect.pre(() => {
    if (app.contextMenu) last = app.contextMenu
  })
  const shown = presence(() => !!app.contextMenu, 110)
</script>

{#if shown.mounted && last}
  {#key `${last.x},${last.y}`}
    <MenuView x={last.x} y={last.y} items={last.items} closing={shown.closing} onChoose={closeMenu} />
  {/key}
{/if}
