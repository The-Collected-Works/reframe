<!--
  The title bar: the folder, the artboard tabs, then (pushed right) updates, info and the view
  tools. Most of it is the window's drag region; controls cut themselves out of it.
-->
<script lang="ts">
  import { api } from '../../lib/bridge'
  import { combo, MOD } from '../../lib/keys'
  import { app } from '../../state/app.svelte'
  import Icon from '../../ui/Icon.svelte'
  import Segmented from '../../ui/Segmented.svelte'
  import Slider from '../../ui/Slider.svelte'
  import AddArtboard from './AddArtboard.svelte'
  import AppInfo from './AppInfo.svelte'
  import ArtboardTabs from './ArtboardTabs.svelte'
  import FolderMenu from './FolderMenu.svelte'
  import UpdateButton from './UpdateButton.svelte'
  import { updateCheck } from './updates.svelte'
  import ViewOptions from './ViewOptions.svelte'

  let { onOpen }: { onOpen: (dir?: string) => void } = $props()
  const update = updateCheck()
</script>

<header class={['topbar', api.platform]}>
  <FolderMenu dir={app.dir} {onOpen} />

  {#if app.dir}
    <div class="tabs">
      <ArtboardTabs />
      <AddArtboard />
    </div>
  {/if}

  <div class="drag spacer"></div>

  {#if update.current}<UpdateButton update={update.current} />{/if}
  <AppInfo />

  {#if app.dir}
    <div class="tools">
      {#if app.view === 'grid'}
        <ViewOptions />
        <Slider value={app.cellSize} min={120} max={480} step={1} width={96} title="Thumbnail size" onChange={(v) => app.setCellSize(v)} />
      {/if}
      <Segmented
        compact
        value={app.view}
        options={[
          { value: 'grid', icon: 'grid', title: 'Grid (E)' },
          { value: 'single', icon: 'single', title: 'Single (E)' }
        ]}
        onChange={(v) => app.setView(v)}
      />
      <button class="primary" onclick={() => app.setExportOpen(true)} title={`Export (${combo(MOD, 'E')})`}>
        <Icon name="export" size={14} />
        Export
      </button>
    </div>
  {/if}
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
