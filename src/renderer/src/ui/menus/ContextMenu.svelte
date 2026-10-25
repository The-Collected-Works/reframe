<!-- The app's own context menu: same surface as its popovers, with icons, shortcuts and checks. -->
<script lang="ts">
  import Menu from './ContextMenuView.svelte'
  import { closeMenu, contextMenu } from './context-menu.svelte'
</script>

{#if contextMenu.open}
  {#key contextMenu.open}
    <Menu menu={contextMenu.open} onChoose={closeMenu} />
  {/key}
{/if}
