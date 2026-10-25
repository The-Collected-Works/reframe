<!-- A labelled group in a form: the label above, the controls below. -->
<script lang="ts">
  import type { Snippet } from 'svelte'

  let { label, children }: { label: string; children: Snippet } = $props()
</script>

<div class="field">
  <div class="label">{label}</div>
  {@render children()}
</div>

<style>
  .label {
    margin-bottom: 8px;
    color: var(--muted);
    font-size: 11px;
  }
</style>
