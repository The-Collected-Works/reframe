<!--
  The export: set up what to write and how, run it, then show the result. Its connection to app
  state; the setup form and the progress list take props.
-->
<script lang="ts">
  import { untrack } from 'svelte'
  import { SvelteSet } from 'svelte/reactivity'
  import { api } from '../../lib/bridge'
  import { join } from '../../lib/paths'
  import { library } from '../../state/library.svelte'
  import { project } from '../../state/project.svelte'
  import { selection } from '../../state/selection.svelte'
  import { shell } from '../../state/shell.svelte'
  import { view } from '../../state/view.svelte'
  import { Button, Dialog } from '../../ui'
  import ExportProgress from './ExportProgress.svelte'
  import ExportSetup, { type Scope } from './ExportSetup.svelte'
  import { ExportJob } from './job.svelte'
  import { plan } from './plan'

  const prefs = $derived(project.file.export)
  const out = $derived(prefs.dir ?? join(library.dir!, 'export'))

  const included = new SvelteSet(untrack(() => project.file.artboards.map((b) => b.id)))
  const counts = $derived({ all: library.assets.length, visible: view.visible.length, selected: selection.size })
  // A wider choice than "all" starts out chosen: several selected, or a filtered grid.
  let scope = $state<Scope>(untrack(() => (selection.size > 1 ? 'selected' : view.visible.length < library.assets.length ? 'visible' : 'all')))
  const items = $derived.by(() => {
    const boards = project.file.artboards.filter((b) => included.has(b.id))
    const pool = scope === 'selected' ? library.assets.filter((a) => selection.has(a.name)) : scope === 'visible' ? view.visible : library.assets
    return plan(boards, pool, library.meta, project.file.clips, out, prefs)
  })

  let job = $state.raw<ExportJob | null>(null)
  const running = $derived(!!job && !job.finished)
  const start = () => (job = new ExportJob(items, out, prefs)).run()
  const close = () => (shell.exportOpen = false)

  // Progress on the taskbar / Dock icon while running.
  $effect(() => {
    api.setProgress(running ? job!.progress : -1)
  })
  $effect(() => () => void api.setProgress(-1))
</script>

<Dialog title="Export" closable={!running} onClose={close} gap={job ? 14 : 18}>
  {#if job}
    <ExportProgress {job} />
  {:else}
    <ExportSetup
      {out}
      artboards={project.file.artboards}
      current={project.boardId}
      {included}
      {scope}
      {counts}
      {prefs}
      images={items.some((i) => i.asset.kind === 'image')}
      videos={items.some((i) => i.asset.kind === 'video')}
      onChooseDir={async () => {
        const d = await api.chooseExportDir(out)
        if (d) project.setExportPrefs({ dir: d })
      }}
      onToggleBoard={(id, on) => (on ? included.add(id) : included.delete(id))}
      onScope={(s) => (scope = s)}
      onPrefs={(patch) => project.setExportPrefs(patch)}
    />
  {/if}

  {#snippet footer()}
    {#if !job}
      <span class="muted">{items.length ? `${items.length} file${items.length === 1 ? '' : 's'}` : 'Nothing to export'}</span>
      <div class="spacer"></div>
      <Button variant="primary" disabled={!items.length} onclick={start}>Export</Button>
    {:else if running}
      <div class="spacer"></div>
      <Button onclick={() => job?.cancel()}>Cancel</Button>
    {:else}
      <Button onclick={() => api.reveal(out)}>Show in folder</Button>
      <div class="spacer"></div>
      <Button variant="primary" onclick={close}>Done</Button>
    {/if}
  {/snippet}
</Dialog>
