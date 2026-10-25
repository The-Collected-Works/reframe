<!-- The app's own context menu: same surface as its popovers, with icons, shortcuts and checks. -->
<script lang="ts">
  import { closeMenu } from '../features/menus'
  import { app } from '../state/app.svelte'
  import Menu from './Menu.svelte'
</script>

{#if app.contextMenu}
  {#key app.contextMenu}
    <Menu menu={app.contextMenu} onChoose={closeMenu} />
  {/key}
{/if}
