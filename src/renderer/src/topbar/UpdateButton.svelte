<!--
  Hovering reveals what's new: the notes of every release since this build, newest first. The
  dropdown stays open while the pointer moves between the two. Clicking opens the release page, or,
  once the installed app has downloaded the update itself, restarts into it.
-->
<script lang="ts">
  import { api } from '../media'
  import Icon from '../ui/Icon.svelte'
  import Popover from '../ui/Popover.svelte'
  import Notes from './Notes.svelte'
  import type { Update } from './updates.svelte'

  let { update }: { update: Update } = $props()
  const status = $derived(update.status)
  const ready = $derived(status.state === 'ready')
  const downloading = $derived(status.state === 'downloading')
  const act = () => (ready ? api.installUpdate() : downloading ? undefined : api.openRelease())

  // Open on hover: after a short pause (so passing over doesn't flash it), and staying open while
  // the pointer moves from the anchor into the dropdown (`keep`) and briefly after it leaves both.
  let open = $state(false)
  let timer: ReturnType<typeof setTimeout> | undefined
  const later = (fn: () => void, ms: number) => {
    clearTimeout(timer)
    timer = setTimeout(fn, ms)
  }
  const enter = () => later(() => (open = true), open ? 0 : 180)
  const leave = () => later(() => (open = false), 220)
  const keep = () => clearTimeout(timer)
  $effect(() => () => clearTimeout(timer))

  const fmtDate = (iso: string) => {
    const d = new Date(iso)
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  }
</script>

<div class="update-wrap" role="presentation" onpointerenter={enter} onpointerleave={leave}>
  <button
    class={'update' + (downloading ? ' downloading' : '')}
    style:--p={status.state === 'downloading' ? `${status.percent}%` : undefined}
    title={open ? undefined : ready ? 'Restart Reframe to finish updating' : `Reframe ${update.version} is available`}
    onclick={act}
  >
    <Icon name="update" size={14} />
    {#if ready}
      Restart to update
    {:else if status.state === 'downloading'}
      Updating
      <span class="muted">{status.percent}%</span>
    {:else}
      Update
      <span class="muted">{update.version}</span>
    {/if}
  </button>
  <Popover open={open && update.notes.length > 0} onClose={() => (open = false)} class="changelog">
    <div class="changelog-body" role="presentation" onpointerenter={keep} onpointerleave={leave}>
      <div class="changelog-scroll">
        {#each update.notes as n (n.version)}
          <section class="release">
            <header>
              <span class="release-version">{n.version}</span>
              {#if n.date}<span class="muted">{fmtDate(n.date)}</span>{/if}
            </header>
            {#if n.body.trim()}<Notes text={n.body} />{:else}<p class="muted">No notes for this release.</p>{/if}
          </section>
        {/each}
      </div>
      <div class="menu-sep"></div>
      <button class="ghost changelog-download" disabled={downloading} onclick={act}>
        <Icon name={ready ? 'update' : 'download'} size={14} />
        {ready ? `Restart to update to ${update.version}` : downloading ? `Downloading ${update.version}…` : `Download ${update.version}`}
      </button>
    </div>
  </Popover>
</div>
