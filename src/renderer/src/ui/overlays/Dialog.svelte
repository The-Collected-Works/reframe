<!--
  A modal sheet over a dimmed window: a title (with a close button while `closable`), the body, and
  a footer row for actions. Esc or a click on the backdrop closes it too, while closable. Render it
  inside an {#if}; it animates in, and out when the {#if} closes.
-->
<script lang="ts">
  import type { Snippet } from 'svelte'
  import { closing } from '../../lib/motion'
  import Button from '../buttons/Button.svelte'

  let {
    title,
    closable = true,
    onClose,
    gap = 18,
    children,
    footer
  }: {
    title: string
    closable?: boolean
    onClose: () => void
    /** Space between the body's sections. */
    gap?: number
    children: Snippet
    footer: Snippet
  } = $props()

  const onkeydown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && closable) onClose()
  }
</script>

<svelte:window {onkeydown} />

<div class="backdrop" role="presentation" out:closing|global={{ duration: 180 }} onpointerdown={(e) => e.target === e.currentTarget && closable && onClose()}>
  <div class="sheet" role="dialog" aria-label={title}>
    <header>
      <span>{title}</span>
      {#if closable}<Button variant="icon" icon="close" iconSize={14} aria-label="Close" onclick={onClose} />{/if}
    </header>
    <div class="body" style:gap={`${gap}px`}>{@render children()}</div>
    <footer>{@render footer()}</footer>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 80;
    display: grid;
    place-items: center;
    background: rgba(0, 0, 0, 0.55);
    animation: fade 180ms var(--ease-cubic) both;
  }

  .sheet {
    width: 460px;
    max-height: calc(100vh - 96px);
    display: flex;
    flex-direction: column;
    background: var(--panel);
    border-radius: 12px;
    box-shadow:
      0 0 0 1px var(--line-strong),
      0 24px 80px rgba(0, 0, 0, 0.6);
    animation: sheet-in 280ms var(--spring) both;
  }

  .backdrop:global(.closing) {
    animation: fade-out 180ms var(--ease-cubic) forwards;
    pointer-events: none;
  }

  .backdrop:global(.closing) .sheet {
    animation: sheet-out 180ms var(--ease) forwards;
  }

  @keyframes sheet-in {
    from {
      opacity: 0;
      transform: translateY(10px) scale(0.97);
    }
  }

  @keyframes sheet-out {
    to {
      opacity: 0;
      transform: translateY(6px) scale(0.98);
    }
  }

  @keyframes fade-out {
    to {
      opacity: 0;
    }
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 12px 4px 20px;
    font-size: 13px;
    font-weight: 600;
  }

  .body {
    padding: 8px 20px 16px;
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    min-height: 0;
  }

  footer {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 16px 12px 20px;
    border-top: 1px solid var(--line);
  }
</style>
