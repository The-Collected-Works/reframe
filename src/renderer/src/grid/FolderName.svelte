<!-- Folder icon and the full path from a leading slash, parents muted: "/" for the top level, "/ Shoot A / Day 2". -->
<script lang="ts">
  import Icon from '../ui/Icon.svelte'

  let { folder }: { folder: string } = $props()
  const crumbs = $derived(folder ? folder.split('/') : ['/'])
</script>

<span class="section-icon" aria-hidden="true"><Icon name="folder" size={13} /></span>
<span class="section-path">
  <!-- Nested folders keep the top level's leading slash, so every path reads from "/". -->
  {#if folder}<span class="section-sep" aria-hidden="true">/</span>{/if}{#each crumbs as c, i (i)}{#if i > 0}<span class="section-sep" aria-hidden="true">/</span>{/if}<span class={i === crumbs.length - 1 ? 'section-crumb current' : 'section-crumb'}>{c}</span>{/each}
</span>
