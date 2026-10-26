<!-- An export as it runs: overall progress, then each file with its state (and why one failed). -->
<script lang="ts">
  import { Icon } from '../../ui'
  import type { ExportJob } from './job.svelte'

  let { job }: { job: ExportJob } = $props()
</script>

<div class="overall">
  <div class="bar"><div style:width={`${job.progress * 100}%`}></div></div>
  <div class="overall-meta">
    <span>
      {job.finished
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
      <span class="job-name">{i.asset.source || i.asset.kind === 'grid' ? i.asset.label : i.asset.name}</span>
      <span class="muted small">{i.board.name}</span>
      <span class="job-state">
        {#if st?.state === 'running' && i.out === 'video'}{Math.round(st.progress * 100)}%{:else if st?.state === 'done'}<Icon
            name="check"
            size={12}
          />{:else if st?.state === 'error'}Failed{/if}
      </span>
      {#if st?.error}<span class="job-error">{st.error}</span>{/if}
    </div>
  {/each}
</div>

<style>
  .bar {
    height: 4px;
    border-radius: 2px;
    background: var(--raised);
    overflow: hidden;
  }

  .bar div {
    height: 100%;
    background: var(--text);
    transition: width 300ms var(--ease);
  }

  .overall-meta {
    margin-top: 8px;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }

  .jobs {
    display: flex;
    flex-direction: column;
    max-height: 320px;
    overflow-y: auto;
    margin: 0 -8px;
  }

  .job {
    display: grid;
    grid-template-columns: 1fr auto 48px;
    align-items: center;
    gap: 12px;
    min-height: 26px;
    padding: 0 8px;
    border-radius: 6px;
    color: var(--faint);
    transition: color var(--t-med) var(--ease);
  }

  .job.running,
  .job.done {
    color: var(--text);
  }

  .job.error {
    color: var(--danger);
  }

  .job-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .job-state {
    display: flex;
    justify-content: flex-end;
    font-variant-numeric: tabular-nums;
    color: var(--muted);
  }

  .job-state :global(svg) {
    animation: dot-in 300ms var(--spring) both;
  }

  .job-error {
    grid-column: 1 / -1;
    font-size: 11px;
    padding-bottom: 6px;
    user-select: text;
  }
</style>
