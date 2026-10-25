<!-- The app's own context menu: same surface as its popovers, with icons, shortcuts and checks. -->
<script lang="ts">
  import Menu from './Menu.svelte'
  import { closeMenu, contextMenu } from './menu.svelte'
</script>

{#if contextMenu.open}
  {#key contextMenu.open}
    <Menu menu={contextMenu.open} onChoose={closeMenu} />
  {/key}
{/if}
