<script lang="ts">
  import { parseNotes, type Span } from './notes'

  let { text }: { text: string } = $props()
  const blocks = $derived(parseNotes(text))
</script>

{#snippet spans(list: Span[])}{#each list as s, i (i)}{#if s.style === 'strong'}<strong>{s.text}</strong>{:else if s.style === 'code'}<code>{s.text}</code
      >{:else}{s.text}{/if}{/each}{/snippet}

<div class="notes">
  {#each blocks as b, i (i)}
    {#if b.kind === 'h'}
      <h4>{@render spans(b.spans)}</h4>
    {:else if b.kind === 'p'}
      <p>{@render spans(b.spans)}</p>
    {:else if b.kind === 'ul'}
      <ul>
        {#each b.items as item, j (j)}<li>{@render spans(item)}</li>{/each}
      </ul>
    {/if}
  {/each}
</div>

<style>
  .notes {
    color: var(--muted);
    line-height: 1.5;
    overflow-wrap: anywhere;
    user-select: text;
  }

  h4 {
    margin: 10px 0 2px;
    font-size: 12px;
    font-weight: 600;
    color: var(--text);
  }

  h4:first-child {
    margin-top: 2px;
  }

  p,
  ul {
    margin: 4px 0;
  }

  ul {
    padding-left: 16px;
  }

  li + li {
    margin-top: 2px;
  }

  strong {
    font-weight: 600;
    color: var(--text);
  }

  code {
    padding: 0 4px;
    border-radius: 4px;
    background: var(--tint-2);
    font: 11px var(--font-mono);
  }
</style>
