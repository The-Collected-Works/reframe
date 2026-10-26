<script lang="ts">
  import type { Snippet } from 'svelte'
  import { Dot } from '../../ui'

  let {
    label,
    overridden,
    onReset,
    onMakeDefault,
    children
  }: { label: string; overridden: boolean; onReset: () => void; onMakeDefault?: () => void; children: Snippet } = $props()
</script>

<div class="row">
  <div class="row-label">
    {label}
    {#if overridden}
      <Dot title="Reset to default" onclick={onReset} />
      <!-- Revealed on hover: promote this value to the artboard's default. -->
      {#if onMakeDefault}
        <button class="row-action" title="Use this value as the default for every asset" onclick={onMakeDefault}>Make default</button>
      {/if}
    {/if}
  </div>
  <div class="row-body">{@render children()}</div>
</div>

<style>
  .row {
    padding: 12px 16px;
  }

  .row-label {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 16px;
    margin-bottom: 8px;
    color: var(--muted);
    font-size: 11px;
  }

  /* Text-only action, revealed on row hover: no chrome to crowd the 16px label row. */
  .row-action {
    margin-left: auto;
    font-size: 11px;
    font-weight: 500;
    color: var(--faint);
    opacity: 0;
    transition:
      opacity var(--t-fast) var(--ease),
      color var(--t-fast) var(--ease);
  }

  .row:hover .row-action {
    opacity: 1;
  }

  .row-action:hover {
    color: var(--text);
  }

  .row-body {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  /* A switch sits on the label's line. */
  .row:has(:global(.toggle)) {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .row:has(:global(.toggle)) .row-label {
    margin: 0;
  }
</style>
