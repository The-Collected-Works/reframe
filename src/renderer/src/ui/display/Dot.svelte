<!-- The accent dot that marks something as adjusted. With `onclick` it's a button (reset, say). -->
<script lang="ts">
  let { title, onclick }: { title: string; onclick?: () => void } = $props()
</script>

{#if onclick}
  <button class="dot" {title} aria-label={title} {onclick}></button>
{:else}
  <span class="dot" {title}></span>
{/if}

<style>
  .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent);
    flex-shrink: 0;
    animation: dot-in 280ms var(--spring) both;
  }

  button.dot:hover {
    box-shadow: 0 0 0 3px var(--accent-soft);
  }
</style>
