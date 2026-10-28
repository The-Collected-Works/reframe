<!--
  The title bar: the folder, the artboard tabs, then (pushed right) updates, the view tools and
  info. Most of it is the window's drag region; controls cut themselves out of it. The one part of
  the bar that reads and changes app state; everything in it takes props.
-->
<script lang="ts">
  import { api } from '../../lib/bridge'
  import { hint } from '../../lib/keymap.svelte'
  import { copies } from '../../state/playback.svelte'
  import { addBoard, collapseAll, deleteBoard, duplicateBoard, openFolder, resetView, setMode, setViewPrefs } from '../../state/actions'
  import { library } from '../../state/library.svelte'
  import { project } from '../../state/project.svelte'
  import { shell } from '../../state/shell.svelte'
  import { view } from '../../state/view.svelte'
  import { Button, Segmented, Slider } from '../../ui'
  import { GLOBAL } from '../../config/keymaps'
  import { boardMenu, openFolderMenu } from '../menus'
  import AddArtboard from './AddArtboard.svelte'
  import AppInfo from './AppInfo.svelte'
  import CopyActivity from './CopyActivity.svelte'
  import ArtboardTabs from './ArtboardTabs.svelte'
  import FolderMenu from './FolderMenu.svelte'
  import UpdateButton from './UpdateButton.svelte'
  import { updateCheck } from './updates.svelte'
  import ViewOptions from './ViewOptions.svelte'

  const update = updateCheck()
  let recent = $state<string[]>([])
</script>

<header class={['topbar', api.platform]}>
  <FolderMenu
    dir={library.dir}
    {recent}
    onShow={() =>
      api.recentFolders().then(
        (r) => (recent = r),
        () => {}
      )}
    onOpen={openFolder}
    onMenu={openFolderMenu}
    onForget={(d) =>
      api.forgetFolder(d).then(
        (r) => (recent = r),
        () => {}
      )}
  />

  {#if library.dir}
    <div class="tabs">
      <ArtboardTabs
        boards={project.file.artboards}
        current={project.boardId}
        editing={shell.editingBoard}
        renaming={shell.renamingBoard}
        onSelect={(id) => (project.boardId = id)}
        onEdit={(id) => (shell.editingBoard = id)}
        onRename={(id) => (shell.renamingBoard = id)}
        onMenu={boardMenu}
        onChange={(id, patch) => project.updateBoard(id, patch)}
        onDuplicate={duplicateBoard}
        onDelete={deleteBoard}
      />
      <AddArtboard onAdd={addBoard} />
    </div>
  {/if}

  <div class="drag spacer"></div>
  {#if library.dir && copies.activity}<CopyActivity {...copies.activity} />{/if}

  {#if update.current}<UpdateButton update={update.current} onInstall={() => api.installUpdate()} onOpenRelease={() => api.openRelease()} />{/if}

  {#if library.dir}
    <div class="tools">
      {#if view.mode === 'grid'}
        <ViewOptions
          prefs={view.prefs}
          counts={() => view.counts()}
          hasFolders={library.folders.length > 0}
          changed={view.changed}
          onChange={setViewPrefs}
          onCollapseAll={collapseAll}
          onReset={resetView}
        />
        <Slider value={view.cellSize} min={120} max={480} step={1} width={96} title="Thumbnail size" onChange={(v) => (view.cellSize = v)} />
      {/if}
      <Segmented
        compact
        value={view.mode}
        options={[
          { value: 'grid', icon: 'grid', title: `Grid (${hint(GLOBAL.actions.switchView)})` },
          { value: 'single', icon: 'single', title: `Single (${hint(GLOBAL.actions.switchView)})` }
        ]}
        onChange={setMode}
      />
      <Button variant="primary" icon="export" iconSize={14} onclick={() => (shell.exportOpen = true)} title={`Export (${hint(GLOBAL.actions.exportAll)})`}
        >Export</Button
      >
    </div>
  {/if}
  <AppInfo />
</header>

<style>
  .topbar {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0 12px;
    border-bottom: 1px solid var(--line);
    -webkit-app-region: drag;
    min-width: 0;
  }

  /* Clear of the window controls the OS draws over the bar. */
  .topbar.darwin {
    padding-left: 84px;
  }

  .topbar.win32,
  .topbar.linux {
    padding-right: 148px;
  }

  /* Everything but the empty stretch is a control, not part of the drag region. */
  .topbar > :global(*:not(.drag)) {
    -webkit-app-region: no-drag;
  }

  .tabs {
    display: flex;
    align-items: center;
    gap: 2px;
    min-width: 0;
    padding-left: 10px;
    border-left: 1px solid var(--line);
  }

  .tabs > :global(*) {
    -webkit-app-region: no-drag;
  }

  .tools {
    display: flex;
    align-items: center;
    gap: 12px;
  }
</style>
