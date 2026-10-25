<script lang="ts">
  import { toast } from './toast.svelte'
</script>

{#if toast.current}
  {#key toast.current.n}<div class="toast" role="status">{toast.current.text}</div>{/key}
{/if}

<style>
  .toast {
    position: fixed;
    /* Centred over the content, not the window: the inspector is on the right. */
    left: calc(50% - var(--inspector-w) / 2);
    bottom: 28px;
    translate: -50% 0;
    z-index: 90;
    padding: 7px 14px;
    border-radius: 999px;
    background: rgba(30, 30, 34, 0.92);
    box-shadow:
      0 0 0 1px var(--line-strong),
      0 10px 30px rgba(0, 0, 0, 0.45);
    backdrop-filter: blur(12px);
    font-size: 12px;
    font-weight: 500;
    pointer-events: none;
    animation: toast 1500ms var(--ease) both;
  }

  @keyframes toast {
    0% {
      opacity: 0;
      transform: translateY(8px) scale(0.96);
    }
    12%,
    78% {
      opacity: 1;
      transform: none;
    }
    100% {
      opacity: 0;
      transform: translateY(4px);
    }
  }
</style>
