<!--
  Hovering reveals what's new: the notes of every release since this build, newest first. The
  dropdown stays open while the pointer moves between the two. Clicking opens the release page, or,
  once the installed app has downloaded the update itself, restarts into it.
-->
<script lang="ts">
  import { api } from '../../lib/bridge'
  import Icon from '../../ui/Icon.svelte'
  import Popover from '../../ui/Popover.svelte'
  import ReleaseNotes from './ReleaseNotes.svelte'
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

<div class="anchor" role="presentation" onpointerenter={enter} onpointerleave={leave}>
  <button
    class={['update', { downloading }]}
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
  <Popover open={open && update.notes.length > 0} onClose={() => (open = false)} padding={0}>
    <div class="body" role="presentation" onpointerenter={keep} onpointerleave={leave}>
      <div class="scroll">
        {#each update.notes as n (n.version)}
          <section class="release">
            <header>
              <span class="release-version">{n.version}</span>
              {#if n.date}<span class="muted">{fmtDate(n.date)}</span>{/if}
            </header>
            {#if n.body.trim()}<ReleaseNotes text={n.body} />{:else}<p class="muted">No notes for this release.</p>{/if}
          </section>
        {/each}
      </div>
      <div class="menu-sep"></div>
      <button class="ghost download" disabled={downloading} onclick={act}>
        <Icon name={ready ? 'update' : 'download'} size={14} />
        {ready ? `Restart to update to ${update.version}` : downloading ? `Downloading ${update.version}…` : `Download ${update.version}`}
      </button>
    </div>
  </Popover>
</div>

<style>
  .anchor {
    display: inline-flex;
    flex-shrink: 0;
  }

  /* A plain tinted button, like the rest of the bar: present, but no louder than Export. */
  .update {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: var(--control);
    padding: 0 11px 0 9px;
    border-radius: var(--radius);
    background: var(--tint-2);
    color: var(--text);
    font-weight: 500;
    font-variant-numeric: tabular-nums;
    flex-shrink: 0;
    animation: pop-in 260ms var(--spring) both;
    transition:
      background-color var(--t-fast) var(--ease),
      color var(--t-fast) var(--ease),
      transform var(--t-fast) var(--ease);
  }

  .update:not(.downloading):hover {
    background: var(--tint-3);
  }

  .update:active {
    transform: scale(0.95);
  }

  /* While the installed app downloads an update, the button fills from the left. */
  .downloading {
    background: linear-gradient(to right, var(--tint-3) var(--p), var(--tint-2) var(--p));
    cursor: default;
  }

  /* What's new, revealed by hovering the button. */
  .body {
    width: 320px;
    display: flex;
    flex-direction: column;
    padding: 6px;
  }

  /* Its scrollbar is always shown, so it's clear there's more below. */
  .scroll {
    max-height: min(380px, calc(100vh - 160px));
    overflow-y: auto;
    padding: 4px 4px 2px 6px;
  }

  .scroll::-webkit-scrollbar-thumb {
    background-color: var(--line-strong);
  }

  .release + .release {
    margin-top: 12px;
    padding-top: 12px;
    border-top: 1px solid var(--line);
  }

  .release header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    margin-bottom: 4px;
  }

  .release-version {
    font-weight: 600;
  }

  .release header .muted {
    font-size: 11px;
  }

  .download {
    justify-content: center;
    width: 100%;
  }
</style>
