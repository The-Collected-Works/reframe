<!--
  The folder button: a menu with Open Folder… and the folders opened recently, newest first (so
  the open one leads). Each recent folder can be dropped from the list.
-->
<script lang="ts">
  import { combo, MOD } from '../../lib/keys'
  import { basename, samePath } from '../../lib/paths'
  import { Icon, MenuItem, MenuLabel, MenuSeparator, Popover } from '../../ui'

  let {
    dir,
    recent,
    onShow,
    onOpen,
    onForget
  }: {
    dir: string | null
    recent: string[]
    /** The menu is opening (time to fetch the recent folders). */
    onShow: () => void
    /** Opens `dir`, or (without one) asks which folder. */
    onOpen: (dir?: string) => void
    onForget: (dir: string) => void
  } = $props()

  let open = $state(false)
  const shown = $derived(recent.slice(0, 5))
  const toggle = () => {
    open = !open
    if (open) onShow()
  }
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

<div class="anchor">
  <button class={['folder', { open }]} title={dir ?? undefined} onclick={toggle}>
    <Icon name="folder" size={15} />
    <span>{dir ? basename(dir) : 'Open folder'}</span>
  </button>
  <Popover {open} onClose={() => (open = false)}>
    <div class="menu">
      <MenuItem detail={combo(MOD, 'O')} onclick={() => pick()}>Open Folder…</MenuItem>
      {#if shown.length > 0}
        <MenuSeparator />
        <MenuLabel>Recent</MenuLabel>
        {#each shown as d (d)}
          <div class="recent">
            <MenuItem title={d} onclick={() => pick(d)}>
              <span class="recent-name">{basename(d) || d}</span>
              <span class="recent-path muted">{shortParent(d)}</span>
            </MenuItem>
            <button class="recent-forget" title="Remove from recent folders" aria-label="Remove from recent folders" onclick={() => onForget(d)}>
              <Icon name="close" size={12} />
            </button>
          </div>
        {/each}
      {/if}
    </div>
  </Popover>
</div>

<style>
  .anchor {
    position: relative;
  }

  .folder {
    display: flex;
    align-items: center;
    gap: 7px;
    height: var(--control);
    padding: 0 10px 0 8px;
    border-radius: var(--radius);
    color: var(--text);
    font-weight: 500;
    max-width: 220px;
    flex-shrink: 0;
    transition:
      background-color var(--t-fast) var(--ease),
      color var(--t-fast) var(--ease),
      transform var(--t-fast) var(--ease);
  }

  .folder span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .folder :global(svg) {
    color: var(--muted);
    flex-shrink: 0;
  }

  .folder:hover,
  .folder.open {
    background: var(--tint-2);
  }

  .folder:active {
    transform: scale(0.95);
  }

  /* Open Folder…, then recent folders with their parent path and a remove button. */
  .menu {
    width: 308px;
  }

  .recent {
    position: relative;
  }

  /* (Specific enough to win over MenuItem's own layout.) */
  .menu .recent :global(.menu-item) {
    justify-content: flex-start;
    gap: 8px;
    text-align: left;
    padding-right: 34px;
  }

  .recent-name {
    flex-shrink: 0;
    max-width: 55%;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .recent-path {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: 11px;
  }

  /* The remove button sits over the row's right end, shown while the row is hovered. */
  .recent-forget {
    position: absolute;
    top: 50%;
    right: 6px;
    width: 22px;
    height: 22px;
    margin-top: -11px;
    display: grid;
    place-items: center;
    border-radius: 5px;
    color: var(--muted);
    opacity: 0;
    transition:
      opacity var(--t-fast) var(--ease),
      background-color var(--t-fast) var(--ease);
  }

  .recent:hover .recent-forget {
    opacity: 1;
  }

  .recent-forget:hover {
    background: var(--tint-3);
    color: var(--text);
  }
</style>
