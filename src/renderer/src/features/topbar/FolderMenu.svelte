<!--
  The folder button: a menu with Open Folder… and the folders opened recently, newest first (so the
  open one leads). Each recent folder can be dropped from the list.
-->
<script lang="ts">
  import { combo, MOD } from '../../lib/keys'
  import { api } from '../../lib/bridge'
  import { basename, samePath } from '../../lib/paths'
  import Icon from '../../ui/Icon.svelte'
  import Popover from '../../ui/Popover.svelte'

  let { dir, onOpen }: { dir: string | null; onOpen: (dir?: string) => void } = $props()
  let open = $state(false)
  let recent = $state<string[]>([])
  const toggle = () => {
    open = !open
    if (open) api.recentFolders().then((r) => (recent = r), () => {})
  }
  const shown = $derived(recent.slice(0, 5))
  const pick = (d?: string) => {
    open = false
    // Picking the folder that's already open just closes the menu.
    if (!(d && dir && samePath(d, dir))) onOpen(d)
  }

  /** The folder's parent, keeping its last two parts: "…\Clients\Acme". */
  function shortParent(path: string): string {
    const sep = path.includes('\\') ? '\\' : '/'
    const parts = path.split(/[\\/]/).filter(Boolean)
    parts.pop()
    if (parts.length <= 2) return (path.startsWith('/') ? '/' : '') + parts.join(sep)
    return '…' + sep + parts.slice(-2).join(sep)
  }
</script>

<div class="tab-wrap">
  <button class={['folder', { open }]} title={dir ?? undefined} onclick={toggle}>
    <Icon name="folder" size={15} />
    <span>{dir ? basename(dir) : 'Open folder'}</span>
  </button>
  <Popover {open} onClose={() => (open = false)} class="menu folder-menu">
    <button class="menu-item" onclick={() => pick()}>
      <span>Open Folder…</span>
      <span class="muted">{combo(MOD, 'O')}</span>
    </button>
    {#if shown.length > 0}
      <div class="menu-sep"></div>
      <div class="menu-label">Recent</div>
      {#each shown as d (d)}
        <div class="recent">
          <button class="menu-item" title={d} onclick={() => pick(d)}>
            <span class="recent-name">{basename(d) || d}</span>
            <span class="recent-path muted">{shortParent(d)}</span>
          </button>
          <button
            class="recent-forget"
            title="Remove from recent folders"
            aria-label="Remove from recent folders"
            onclick={() => api.forgetFolder(d).then((r) => (recent = r), () => {})}
          >
            <Icon name="close" size={12} />
          </button>
        </div>
      {/each}
    {/if}
  </Popover>
</div>
