<script lang="ts">
  import { toast } from './toast.svelte'
</script>

{#if toast.current}
  {#key toast.current.n}<div class="hud" role="status">{toast.current.text}</div>{/key}
{/if}
