<!--
  A bar over the content while the project can't be saved (see ProjectLock): why, and what can be
  done about it. Saved by a newer Reframe or unreadable, it's open read-only; changed elsewhere,
  edits carry on but wait to be saved until it's reloaded or overwritten.
-->
<script lang="ts">
  import { api } from '../../lib/bridge'
  import { overwriteProject, reloadProject, restoreProject } from '../../state/actions'
  import { library } from '../../state/library.svelte'
  import { project } from '../../state/project.svelte'
  import { Button, Icon } from '../../ui'

  const lock = $derived(library.dir ? project.lock : null)
</script>

<div class="slot">
  {#if lock}
    <div class={['notice', lock.reason]} role="status">
      <Icon name="info" size={15} />
      <p>
        {#if lock.reason === 'newer'}
          <strong>Saved by a newer version of Reframe.</strong> It’s open read-only, so nothing in it is lost. Update Reframe to edit it.
        {:else if lock.reason === 'unreadable'}
          <strong>This folder’s project file couldn’t be read.</strong> It may still be syncing. It’s open read-only, so it isn’t replaced.
        {:else}
          <strong>This project was changed somewhere else</strong> (another computer, or another window) since you opened it. Your edits since then aren’t saved.
        {/if}
      </p>
      <div class="actions">
        {#if lock.reason === 'newer'}
          <Button variant="primary" onclick={() => api.openRelease()}>Get the update</Button>
        {:else if lock.reason === 'unreadable'}
          <Button onclick={reloadProject}>Try again</Button>
          {#if lock.backup}<Button variant="primary" onclick={restoreProject}>Restore last good copy</Button>{/if}
          <Button title="Start a new project in this folder. The unreadable file is kept as .reframe.unreadable.json." onclick={overwriteProject}
            >Start over</Button
          >
        {:else}
          <Button title="Your edits since it changed elsewhere are lost" onclick={reloadProject}>Reload</Button>
          <Button variant="primary" title="What was changed elsewhere is lost" onclick={overwriteProject}>Overwrite with mine</Button>
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .notice {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 8px 6px 14px;
    background: color-mix(in srgb, var(--caution) 12%, var(--panel));
    border-bottom: 1px solid color-mix(in srgb, var(--caution) 30%, var(--line));
    color: var(--caution);
    font-size: 12px;
    animation: fade var(--t-med) var(--ease) both;
  }

  p {
    flex: 1;
    min-width: 0;
    margin: 0;
    color: var(--text);
    line-height: 1.4;
  }

  strong {
    font-weight: 600;
  }

  .actions {
    display: flex;
    gap: 4px;
    flex-shrink: 0;
  }
</style>
