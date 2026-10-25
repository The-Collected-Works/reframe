<script lang="ts">
  import { untrack } from 'svelte'
  import { SvelteSet } from 'svelte/reactivity'
  import { api } from '../../lib/bridge'
  import { closing } from '../../lib/motion'
  import { join } from '../../lib/paths'
  import { app } from '../../state/app.svelte'
  import Icon from '../../ui/Icon.svelte'
  import Segmented from '../../ui/Segmented.svelte'
  import Slider from '../../ui/Slider.svelte'
  import { ExportJob } from './job.svelte'
  import { plan } from './plan'

  const QUALITY: { value: string; label: string; crf: number }[] = [
    { value: 'high', label: 'High', crf: 16 },
    { value: 'medium', label: 'Medium', crf: 20 },
    { value: 'small', label: 'Small', crf: 26 }
  ]

  const project = $derived(app.project)
  const prefs = $derived(project.export)
  const out = $derived(prefs.dir ?? join(app.dir!, 'export'))

  const boards = new SvelteSet(untrack(() => app.project.artboards.map((b) => b.id)))
  // What the grid shows (filters, collapsed folders); offered as a scope when it differs from all.
  const visible = $derived(app.visible)
  let scope = $state<'all' | 'visible' | 'selected'>(
    untrack(() => (app.selection.length > 1 ? 'selected' : app.visible.length < app.assets.length ? 'visible' : 'all'))
  )
  const items = $derived.by(() => {
    const chosen = project.artboards.filter((b) => boards.has(b.id))
    const pool = scope === 'selected' ? app.assets.filter((a) => app.selected.has(a.name)) : scope === 'visible' ? visible : app.assets
    return plan(chosen, pool, app.meta, project.clips, out, prefs)
  })
  const imgCount = $derived(items.filter((i) => i.asset.kind === 'image').length)
  const vidCount = $derived(items.length - imgCount)

  let job = $state.raw<ExportJob | null>(null)
  const phase = $derived(!job ? 'setup' : job.finished ? 'done' : 'running')
  const start = () => (job = new ExportJob(items, out, prefs)).run()

  // Progress on the taskbar / Dock icon while running.
  $effect(() => {
    api.setProgress(phase === 'running' ? job!.progress : -1)
  })
  $effect(() => () => void api.setProgress(-1))

  const crfKey = $derived(QUALITY.reduce((best, q) => (Math.abs(q.crf - prefs.videoCrf) < Math.abs(best.crf - prefs.videoCrf) ? q : best)).value)

  const onkeydown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && phase !== 'running') app.setExportOpen(false)
  }
</script>

<svelte:window {onkeydown} />

<div
  class="modal-backdrop"
  role="presentation"
  out:closing|global={{ duration: 180 }}
  onpointerdown={(e) => e.target === e.currentTarget && phase !== 'running' && app.setExportOpen(false)}
>
  <div class="modal">
    <header class="modal-head">
      <span>Export</span>
      {#if phase !== 'running'}
        <button class="icon-btn" aria-label="Close" onclick={() => app.setExportOpen(false)}><Icon name="close" size={14} /></button>
      {/if}
    </header>

    {#if phase === 'setup'}
      <div class="modal-body">
        <div class="field">
          <div class="field-label">Destination</div>
          <div class="dest">
            <span class="path" title={out}><bdi>{out}</bdi></span>
            <button
              class="ghost"
              onclick={async () => {
                const d = await api.chooseExportDir(out)
                if (d) app.setExportPrefs({ dir: d })
              }}
            >
              Change
            </button>
          </div>
        </div>

        <div class="field">
          <div class="field-label">Artboards</div>
          <div class="checks">
            {#each project.artboards as b (b.id)}
              <label class={['check', { on: boards.has(b.id) }]}>
                <input
                  type="checkbox"
                  checked={boards.has(b.id)}
                  onchange={(e) => (e.currentTarget.checked ? boards.add(b.id) : boards.delete(b.id))}
                />
                <span class="box"><Icon name="check" size={12} /></span>
                <span>{b.name}</span>
                <span class="muted">{b.width}×{b.height}</span>
                {#if b.id === app.boardId}<span class="muted small">current</span>{/if}
              </label>
            {/each}
          </div>
        </div>

        {#if app.selection.length > 0 || visible.length < app.assets.length}
          <div class="field">
            <div class="field-label">Assets</div>
            <Segmented
              value={scope}
              options={[
                { value: 'all' as const, label: `All ${app.assets.length}` },
                ...(visible.length < app.assets.length ? [{ value: 'visible' as const, label: `Visible ${visible.length}`, title: 'What the grid shows' }] : []),
                ...(app.selection.length > 0 ? [{ value: 'selected' as const, label: `Selected ${app.selection.length}` }] : [])
              ]}
              onChange={(v) => (scope = v)}
            />
          </div>
        {/if}

        {#if imgCount > 0}
          <div class="field">
            <div class="field-label">Images</div>
            <div class="inline">
              <Segmented
                value={prefs.imageFormat}
                options={[
                  { value: 'png', label: 'PNG' },
                  { value: 'jpg', label: 'JPG' },
                  { value: 'webp', label: 'WebP' }
                ]}
                onChange={(imageFormat) => app.setExportPrefs({ imageFormat })}
              />
              {#if prefs.imageFormat !== 'png'}
                <div class="slider-row grow">
                  <Slider value={prefs.imageQuality * 100} min={50} max={100} step={1} onChange={(v) => app.setExportPrefs({ imageQuality: v / 100 })} />
                  <span class="muted tabular">{Math.round(prefs.imageQuality * 100)}</span>
                </div>
              {/if}
            </div>
          </div>
        {/if}

        {#if vidCount > 0}
          <div class="field">
            <div class="field-label">Video · MP4</div>
            <Segmented
              value={crfKey}
              options={QUALITY.map((q) => ({ value: q.value, label: q.label }))}
              onChange={(v) => app.setExportPrefs({ videoCrf: QUALITY.find((q) => q.value === v)!.crf })}
            />
          </div>
        {/if}
      </div>
    {:else if job}
      <div class="modal-body progress-body">
        <div class="overall">
          <div class="bar"><div style:width={`${job.progress * 100}%`}></div></div>
          <div class="overall-meta">
            <span>
              {phase === 'done'
                ? job.cancelled
                  ? 'Cancelled'
                  : job.failed
                    ? `${job.done} exported · ${job.failed} failed`
                    : `${job.done} exported`
                : `${job.done} / ${job.items.length}`}
            </span>
          </div>
        </div>
        <div class="jobs">
          {#each job.items as i (i.id)}
            {@const st = job.status[i.id]}
            <div class={['job', st?.state]} title={st?.error}>
              <span class="job-name">{i.asset.name}</span>
              <span class="muted small">{i.board.name}</span>
              <span class="job-state">
                {#if st?.state === 'running' && i.asset.kind === 'video'}{Math.round(st.progress * 100)}%{:else if st?.state === 'done'}<Icon
                    name="check"
                    size={12}
                  />{:else if st?.state === 'error'}Failed{/if}
              </span>
              {#if st?.error}<span class="job-error">{st.error}</span>{/if}
            </div>
          {/each}
        </div>
      </div>
    {/if}

    <footer class="modal-foot">
      {#if phase === 'setup'}
        <span class="muted">{items.length ? `${items.length} file${items.length === 1 ? '' : 's'}` : 'Nothing to export'}</span>
        <div class="spacer"></div>
        <button class="primary" disabled={!items.length} onclick={start}>Export</button>
      {:else if phase === 'running'}
        <div class="spacer"></div>
        <button class="ghost" onclick={() => job?.cancel()}>Cancel</button>
      {:else}
        <button class="ghost" onclick={() => api.reveal(out)}>Show in folder</button>
        <div class="spacer"></div>
        <button class="primary" onclick={() => app.setExportOpen(false)}>Done</button>
      {/if}
    </footer>
  </div>
</div>
