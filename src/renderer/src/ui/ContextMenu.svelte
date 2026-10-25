<!-- The app's own context menu: same surface as its popovers, with icons, shortcuts and checks. -->
<script lang="ts">
  import { closeMenu } from '../menus'
  import { app } from '../store.svelte'
  import MenuView from './MenuView.svelte'
</script>

{#if app.contextMenu}
  {#key app.contextMenu}
    <MenuView menu={app.contextMenu} onChoose={closeMenu} />
  {/key}
{/if}
