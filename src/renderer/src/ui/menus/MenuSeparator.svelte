<!-- A line between groups in a popover menu, out to the popover's edges (`bleed`: its padding). -->
<script lang="ts">
  let { bleed = 6, gap = 6 }: { bleed?: number; gap?: number } = $props()
</script>

<div class="sep" style:margin={`${gap}px -${bleed}px`}></div>

<style>
  .sep {
    height: 1px;
    background: var(--line-strong);
  }
</style>
