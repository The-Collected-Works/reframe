<!--
  The window: the top bar, then the content (grid or single view) beside the inspector, and what
  floats over them (the export dialog, toasts, the context menu). Also the app-wide plumbing: the
  launch, autosave, shortcuts, file drops.
-->
<script lang="ts">
  import { onMount } from 'svelte'
  import ExportDialog from './features/export/ExportDialog.svelte'
  import Grid from './features/grid/Grid.svelte'
  import Inspector from './features/inspector/Inspector.svelte'
  import { onShortcut } from './features/shortcuts'
  import SingleView from './features/single/SingleView.svelte'
  import TopBar from './features/topbar/TopBar.svelte'
  import { api } from './lib/bridge'
  import { FileDrop, refuseDrop } from './lib/file-drop.svelte'
  import { basename } from './lib/paths'
  import { openFolder, rescanFolder } from './state/actions'
  import { autosave } from './state/autosave.svelte'
  import { library } from './state/library.svelte'
  import { shell } from './state/shell.svelte'
  import { view } from './state/view.svelte'
  import { ContextMenu, Icon, Toast } from './ui'

  let booted = $state(false)
  // Reopen the last folder on launch.
  onMount(() => {
    api.lastFolder().then(async (d) => {
      if (d) await openFolder(d)
      booted = true
    })
  })
  // A folder picked from the taskbar's or Dock's recent folders while the app is running.
  $effect(() => api.onOpenFolderRequest((dir) => openFolder(dir)))
  // Pick up files added to or removed from the folder.
  $effect(() => api.onFolderChanged(rescanFolder))

  const saving = autosave()

  // The window controls are drawn by the OS over the page, so CSS can't dim them with the dialog's
  // backdrop; the main process matches them instead.
  $effect(() => {
    api.setOverlayTint(shell.exportOpen ? 'dim' : 'none')
  })

  // The folder in the window title (taskbar, Mission Control, window menus).
  $effect(() => {
    document.title = library.dir ? `${basename(library.dir)} — Reframe` : 'Reframe'
  })

  // Focus rings only while navigating with Tab, as in native apps; any pointer use hides them.
  // (Otherwise a clicked button shows a ring as soon as an arrow key is pressed.)
  let keyboardNav = $state(false)
  $effect(() => {
    document.documentElement.classList.toggle('keyboard-nav', keyboardNav)
  })

  // The viewport (or the empty state) takes dropped folders, and only it tints: the top bar sits
  // under the OS-drawn window controls, which couldn't follow the tint in step.
  const drop = new FileDrop((file) => openFolder(api.pathForFile(file)))
</script>

<svelte:window
  onkeydown={onShortcut}
  onkeydowncapture={(e) => e.key === 'Tab' && (keyboardNav = true)}
  onpointerdowncapture={() => (keyboardNav = false)}
  ondragover={refuseDrop}
  ondrop={refuseDrop}
  onpagehide={saving.flush}
/>

<div class="app">
  <TopBar />
  {#if library.dir}
    <main class="workspace">
      <section class={['content drop-zone', { dropping: drop.dropping }]} {...drop.handlers}>
        <Grid active={view.mode === 'grid'} />
        {#if view.mode === 'single'}<SingleView />{/if}
      </section>
      <Inspector />
    </main>
  {:else if booted}
    <main class={['empty drop-zone', { dropping: drop.dropping }]} {...drop.handlers}>
      <button class="empty-drop" onclick={() => openFolder()}>
        <Icon name="folder" size={28} />
        <span>Open a folder</span>
        <span class="muted small">or drop one here</span>
      </button>
    </main>
  {/if}
  {#if library.dir && library.assets.length === 0}<div class="empty-hint center">No images or videos in this folder</div>{/if}
  {#if shell.exportOpen}<ExportDialog />{/if}
  <Toast />
  <ContextMenu />
</div>

<style>
  .app {
    height: 100%;
    display: grid;
    grid-template-rows: var(--topbar-h) 1fr;
  }

  .workspace {
    display: grid;
    grid-template-columns: 1fr var(--inspector-w);
    min-height: 0;
  }

  .content {
    position: relative;
    min-width: 0;
    min-height: 0;
    background: var(--well);
  }

  /* Dragging files over the viewport: it takes an accent tint, edge to edge. */
  .drop-zone {
    position: relative;
  }

  .drop-zone.dropping::after {
    content: '';
    position: absolute;
    inset: 0;
    background: var(--accent-soft);
    pointer-events: none;
    z-index: 40;
    animation: fade 160ms var(--ease) both;
  }

  .empty {
    display: grid;
    place-items: center;
    background: var(--well);
  }

  .empty-drop {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 48px 72px;
    border: 1px dashed var(--line-strong);
    border-radius: 14px;
    color: var(--text);
    font-size: 13px;
    animation: rise-in 420ms var(--ease) both;
    transition:
      border-color var(--t-med) var(--ease),
      background-color var(--t-med) var(--ease),
      transform var(--t-med) var(--ease);
  }

  .empty-drop :global(svg) {
    color: var(--muted);
    margin-bottom: 4px;
  }

  .empty-drop:hover {
    border-color: var(--faint);
    background: var(--panel);
  }

  .empty-drop:active {
    transform: scale(0.985);
  }

  .empty.dropping .empty-drop {
    border-color: var(--accent);
    transform: scale(1.02);
  }
</style>
