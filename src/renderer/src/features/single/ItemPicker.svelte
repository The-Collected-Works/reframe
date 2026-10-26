<!--
  Choosing what a layout's cell shows: every asset and variant, filterable by name. Takes props.
-->
<script lang="ts">
  import type { Attachment } from 'svelte/attachments'
  import { visibility } from '../../lib/attach'
  import type { Asset } from '../../state/library.svelte'
  import { Button, Dialog, Icon, TextField } from '../../ui'

  let {
    assets,
    current,
    onChoose,
    onSeen,
    onClose
  }: {
    assets: Asset[]
    /** What the cell shows now, if anything. */
    current: string | null
    onChoose: (key: string) => void
    /** On screen with nothing loaded yet. */
    onSeen: (a: Asset) => void
    onClose: () => void
  } = $props()

  let query = $state('')
  const shown = $derived(query.trim() ? assets.filter((a) => a.label.toLowerCase().includes(query.trim().toLowerCase())) : assets)

  const SIZE = 96
  const dpr = window.devicePixelRatio || 1
  /** The whole picture, as it is (not framed): it's the content being chosen, not a crop of it. */
  const thumb =
    (a: Asset): Attachment<HTMLCanvasElement> =>
    (c) => {
      c.width = c.height = SIZE * dpr
      const ctx = c.getContext('2d')!
      ctx.clearRect(0, 0, c.width, c.height)
      if (!a.thumb || !a.w) return
      const s = Math.min(c.width / a.w, c.height / a.h)
      const w = a.w * s
      const h = a.h * s
      ctx.drawImage(a.thumb, (c.width - w) / 2, (c.height - h) / 2, w, h)
    }
  const focus: Attachment<HTMLInputElement> = (input) => {
    const raf = requestAnimationFrame(() => input.focus())
    return () => cancelAnimationFrame(raf)
  }
</script>

<Dialog title="Choose what this cell shows" {onClose} gap={12}>
  <TextField placeholder="Filter by name" value={query} oninput={(e) => (query = e.currentTarget.value)} spellcheck="false" {@attach focus} />
  <div class="choices">
    {#each shown as a (a.name)}
      <button class={['choice', { on: a.name === current }]} title={a.source ? `${a.label} · from ${a.source}` : a.name} onclick={() => onChoose(a.name)}>
        <canvas {@attach thumb(a)} {@attach visibility((v) => v && !a.thumb && onSeen(a))} style:width={`${SIZE}px`} style:height={`${SIZE}px`}></canvas>
        <span class="choice-name">
          {#if a.source}<Icon name="variant" size={11} />{/if}
          <span>{a.label}</span>
        </span>
      </button>
    {/each}
    {#if !shown.length}<div class="muted none">Nothing called that</div>{/if}
  </div>

  {#snippet footer()}
    <div class="spacer"></div>
    <Button onclick={onClose}>Cancel</Button>
  {/snippet}
</Dialog>

<style>
  .choices {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(112px, 1fr));
    gap: 6px;
    width: min(620px, 80vw);
    max-height: 56vh;
    overflow-y: auto;
  }

  .choice {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 8px 6px 6px;
    border-radius: 8px;
    transition: background-color var(--t-fast) var(--ease);
  }

  .choice:hover {
    background: var(--tint-1);
  }

  .choice.on {
    background: var(--tint-3);
  }

  canvas {
    display: block;
  }

  .choice-name {
    display: flex;
    align-items: center;
    gap: 4px;
    max-width: 100%;
    color: var(--muted);
    font-size: 11px;
  }

  .choice-name span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .choice:hover .choice-name,
  .choice.on .choice-name {
    color: var(--text);
  }

  .none {
    grid-column: 1 / -1;
    padding: 24px;
    text-align: center;
  }
</style>
