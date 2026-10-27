<!--
  The export: set up what to write and how, run it, then show the result. Its connection to app
  state; the setup form and the progress list take props.
-->
<script lang="ts">
  import { untrack } from 'svelte'
  import { SvelteSet } from 'svelte/reactivity'
  import { api } from '../../lib/bridge'
  import { join } from '../../lib/paths'
  import { items as all } from '../../state/items.svelte'
  import { library } from '../../state/library.svelte'
  import { project } from '../../state/project.svelte'
  import { selection } from '../../state/selection.svelte'
  import { shell, type ExportScope } from '../../state/shell.svelte'
  import { view } from '../../state/view.svelte'
  import { Button, Dialog } from '../../ui'
  import ExportProgress from './ExportProgress.svelte'
  import ExportSetup from './ExportSetup.svelte'
  import { ExportJob } from './job.svelte'
  import { plan } from './plan'

  const prefs = $derived(project.file.export)
  const out = $derived(prefs.dir ?? join(library.dir!, 'export'))

  const included = new SvelteSet(untrack(() => project.file.artboards.map((b) => b.id)))
  const counts = $derived({ all: all.all.length, visible: view.visible.length, selected: selection.size })
  // The last export's choice, if it's still offered; else a narrower one than "all" when there is
  // one: several selected, or a filtered grid.
  const offered = (s: ExportScope | null) => (s === 'selected' ? counts.selected > 0 : s === 'visible' ? counts.visible < counts.all : s === 'all')
  let scope = $state<ExportScope>(
    untrack(() =>
      offered(shell.exportScope) ? shell.exportScope! : selection.size > 1 ? 'selected' : view.visible.length < all.all.length ? 'visible' : 'all'
    )
  )
  const choose = (s: ExportScope) => (scope = shell.exportScope = s)
  const items = $derived.by(() => {
    const boards = project.file.artboards.filter((b) => included.has(b.id))
    const pool = scope === 'selected' ? all.all.filter((a) => selection.has(a.name)) : scope === 'visible' ? view.visible : all.all
    return plan(boards, pool, (key) => all.asset(key), project.file, out, prefs)
  })

  let job = $state.raw<ExportJob | null>(null)
  const running = $derived(!!job && !job.finished)
  const start = () => {
    shell.exportScope = scope
    return (job = new ExportJob(items, out, prefs)).run()
  }
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
      images={items.some((i) => i.out === 'image')}
      videos={items.some((i) => i.out === 'video')}
      onChooseDir={async () => {
        const d = await api.chooseExportDir(out)
        if (d) project.setExportPrefs({ dir: d })
      }}
      onToggleBoard={(id, on) => (on ? included.add(id) : included.delete(id))}
      onScope={choose}
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
