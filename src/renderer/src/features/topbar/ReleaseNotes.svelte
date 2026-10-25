<script lang="ts">
  import { parseNotes, type Span } from './notes'

  let { text }: { text: string } = $props()
  const blocks = $derived(parseNotes(text))
</script>

{#snippet spans(list: Span[])}{#each list as s, i (i)}{#if s.style === 'strong'}<strong>{s.text}</strong>{:else if s.style === 'code'}<code>{s.text}</code>{:else}{s.text}{/if}{/each}{/snippet}

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
