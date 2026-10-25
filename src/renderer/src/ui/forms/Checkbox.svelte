<!-- A checkbox row: the box, then whatever describes it. -->
<script lang="ts">
  import type { Snippet } from 'svelte'
  import Icon from '../icons/Icon.svelte'

  let { checked, onChange, children }: { checked: boolean; onChange: (checked: boolean) => void; children: Snippet } = $props()
</script>

<label class={['check', { on: checked }]}>
  <input type="checkbox" {checked} onchange={(e) => onChange(e.currentTarget.checked)} />
  <span class="box"><Icon name="check" size={12} /></span>
  {@render children()}
</label>

<style>
  .check {
    display: flex;
    align-items: center;
    gap: 10px;
    height: 34px;
    padding: 0 8px;
    margin: 0 -8px;
    border-radius: 6px;
    transition:
      background-color var(--t-fast) var(--ease),
      color var(--t-fast) var(--ease),
      transform var(--t-fast) var(--ease);
  }

  .check:hover {
    background: var(--raised);
  }

  input {
    display: none;
  }

  .box {
    display: grid;
    place-items: center;
    width: 16px;
    height: 16px;
    border-radius: 4px;
    background: var(--tint-3);
    color: transparent;
  }

  .on .box {
    background: var(--accent);
    color: #fff;
  }
</style>
