<script lang="ts">
  import { combo, MOD } from '../../lib/keys'
  import { api } from '../../state/loading'
  import { boardMenu } from '../menus'
  import { app, PRESETS } from '../../state/app.svelte'
  import Icon from '../../ui/Icon.svelte'
  import Popover from '../../ui/Popover.svelte'
  import Segmented from '../../ui/Segmented.svelte'
  import AppInfo from './AppInfo.svelte'
  import ArtboardEditor from './ArtboardEditor.svelte'
  import FolderMenu from './FolderMenu.svelte'
  import ArtboardTabs from './ArtboardTabs.svelte'
  import UpdateButton from './UpdateButton.svelte'
  import { updateCheck } from './updates.svelte'
  import ViewOptions from './ViewOptions.svelte'

  let { onOpen }: { onOpen: (dir?: string) => void } = $props()
  let adding = $state(false)
  const update = updateCheck()
  const boards = $derived(app.project.artboards)
</script>

<header class={['topbar', api.platform]}>
  <FolderMenu dir={app.dir} {onOpen} />

  {#if app.dir}
    <div class="tabs-wrap">
      <ArtboardTabs>
        {#each boards as b, i (b.id)}
          <div class="tab-wrap">
            <button
              class={['tab', { on: b.id === app.boardId, editing: app.boardEditor === b.id }]}
              title={b.id === app.boardId ? 'Edit artboard' : i < 9 ? combo(MOD, String(i + 1)) : undefined}
              onclick={() => (b.id === app.boardId ? app.setBoardEditor(app.boardEditor === b.id ? null : b.id) : app.setBoard(b.id))}
              oncontextmenu={(e) => {
                e.preventDefault()
                boardMenu(b.id, { x: e.clientX, y: e.clientY })
              }}
            >
              <span>{b.name}</span>
              <span class="dims">{b.width}×{b.height}</span>
              <!-- The active tab opens its editor; the chevron says so. Every tab reserves its space,
                   so switching tabs doesn't change any widths. -->
              <span class="tab-chevron" aria-hidden="true"><Icon name="chevronDown" size={12} /></span>
            </button>
            <ArtboardEditor board={b} open={app.boardEditor === b.id} canDelete={boards.length > 1} />
          </div>
        {/each}
      </ArtboardTabs>
      <div class="tab-wrap">
        <button class="icon-btn" title="Add artboard" onclick={() => (adding = !adding)}>
          <Icon name="plus" size={14} />
        </button>
        <Popover open={adding} onClose={() => (adding = false)} class="menu">
          {#each PRESETS as p (p.name)}
            <button
              class="menu-item"
              onclick={() => {
                app.addBoard(p.name, p.width, p.height)
                adding = false
              }}
            >
              <span>{p.name}</span>
              <span class="muted">{p.width}×{p.height}</span>
            </button>
          {/each}
          <div class="menu-sep"></div>
          <button
            class="menu-item"
            onclick={() => {
              app.addBoard('Custom', 1200, 1200)
              adding = false
              app.setBoardEditor(app.boardId)
            }}
          >
            Custom…
          </button>
        </Popover>
      </div>
    </div>
  {/if}

  <div class="drag-fill"></div>

  {#if update.current}<UpdateButton update={update.current} />{/if}
  <AppInfo />

  {#if app.dir}
    <div class="tools">
      {#if app.view === 'grid'}
        <ViewOptions />
        <input
          type="range"
          class="slider size"
          min={120}
          max={480}
          value={app.cellSize}
          style:--p={`${((app.cellSize - 120) / 360) * 100}%`}
          oninput={(e) => app.setCellSize(Number(e.currentTarget.value))}
          title="Thumbnail size"
        />
      {/if}
      <Segmented
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
