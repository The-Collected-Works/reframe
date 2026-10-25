<script lang="ts">
  import { onMount, untrack } from 'svelte'
  import type { ProjectFile } from '@shared/types'
  import ExportDialog from './features/export/ExportDialog.svelte'
  import Grid from './features/grid/Grid.svelte'
  import { cancelPick, pickBackground } from './features/inspector/eyedropper'
  import Inspector from './features/inspector/Inspector.svelte'
  import SingleView from './features/single/SingleView.svelte'
  import TopBar from './features/topbar/TopBar.svelte'
  import { api } from './lib/bridge'
  import { basename } from './lib/paths'
  import { openFolder, rescanFolder, resetSelection } from './state/actions'
  import { app } from './state/app.svelte'
  import ContextMenu from './ui/ContextMenu.svelte'
  import Icon from './ui/Icon.svelte'
  import Toast from './ui/Toast.svelte'

  let dropping = $state(false)
  let booted = $state(false)

  // The window controls are drawn by the OS over the page, so CSS can't dim them with the dialog's
  // backdrop; the main process matches them instead.
  $effect(() => {
    api.setOverlayTint(app.exportOpen ? 'dim' : 'none')
  })

  // Reopen the last folder on launch.
  onMount(() => {
    api.lastFolder().then(async (d) => {
      if (d) await openFolder(d)
      booted = true
    })
  })
  // A folder picked from the taskbar's or Dock's recent folders while the app is running.
  $effect(() => api.onOpenFolderRequest((dir) => openFolder(dir)))
  // Pick up files added to or removed from the folder.
  $effect(() => api.onFolderChanged(rescanFolder))

  // Autosave the project next to the assets, shortly after edits settle. A save still waiting is
  // written straight away when another folder is opened or the window closes.
  let waiting: { dir: string; project: ProjectFile } | null = null
  let saveTimer: ReturnType<typeof setTimeout> | undefined
  let savedDir: string | null = null
  const flush = () => {
    clearTimeout(saveTimer)
    if (waiting) api.saveProject(waiting.dir, waiting.project).catch(() => {})
    waiting = null
  }
  $effect(() => {
    const { dir, project } = app
    untrack(() => {
      if (dir !== savedDir) {
        savedDir = dir
        return flush()
      }
      if (!dir) return
      waiting = { dir, project }
      clearTimeout(saveTimer)
      saveTimer = setTimeout(flush, 400)
    })
  })
  $effect(() => flush)

  function onkeydown(e: KeyboardEvent) {
    const mod = e.metaKey || e.ctrlKey
    const typing = (e.target as HTMLElement).closest('input, textarea, [contenteditable]')
    if (mod && e.key.toLowerCase() === 'o') {
      e.preventDefault()
      return openFolder()
    }
    if (typing || !app.dir || app.exportOpen) return
    if (app.picking) {
      if (e.key === 'Escape') cancelPick()
      return
    }
    const k = e.key.toLowerCase()
    if (mod) {
      if (k === 'z') app[e.shiftKey ? 'redo' : 'undo']()
      else if (k === 'y') app.redo()
      else if (k === 'a') app.selectAll()
      else if (k === 'c') app.copy()
      else if (k === 'v') app.paste()
      else if (k === 'e') app.setExportOpen(true)
      else if (k === 'r' && e.shiftKey) resetSelection()
      else if (/^[1-9]$/.test(k)) {
        const b = app.project.artboards[Number(k) - 1]
        if (b) app.setBoard(b.id)
      } else return
      e.preventDefault()
      return
    }
    if (app.boardEditor) return
    if (k === 'i') pickBackground()
    else if (k === 'escape') {
      if (app.view === 'single') app.setView('grid')
      else app.clearSelection()
    } else if (k === 'e') app.setView(app.view === 'single' ? 'grid' : 'single')
    // Space opens the selection, like Quick Look; in single view it plays and pauses instead. A
    // focused button keeps Space for itself.
    else if (k === ' ' && app.view === 'grid' && app.focus && !(e.target as HTMLElement).closest('button')) app.setView('single')
    else if (k === 'arrowright' || (k === 'arrowdown' && app.view === 'single')) app.step(1)
    else if (k === 'arrowleft' || (k === 'arrowup' && app.view === 'single')) app.step(-1)
    else if (k === 'arrowdown' || k === 'arrowup') stepRow(k === 'arrowdown' ? 1 : -1)
    else return
    e.preventDefault()
  }

  /**
   * Up / down in the grid: to the nearest thumbnail in the next row that way, by position on
   * screen, so folder headers and short last rows don't throw it off.
   */
  function stepRow(dir: 1 | -1): void {
    const cur = document.querySelector<HTMLElement>('.grid .cell.focused')
    if (!cur) return app.step(dir)
    const r = cur.getBoundingClientRect()
    const cx = r.left + r.width / 2
    let best: { name: string; dy: number; dx: number } | null = null
    for (const c of document.querySelectorAll<HTMLElement>('.grid .cell')) {
      const q = c.getBoundingClientRect()
      const dy = (q.top - r.top) * dir
      if (dy < 2) continue
      const dx = Math.abs(q.left + q.width / 2 - cx)
      if (!best || dy < best.dy - 2 || (Math.abs(dy - best.dy) <= 2 && dx < best.dx)) best = { name: c.dataset.name!, dy, dx }
    }
    if (best) app.select(best.name)
  }

  // Focus rings only while navigating with Tab, as in native apps; any pointer use hides them.
  // (Otherwise a clicked button shows a ring as soon as an arrow key is pressed.)
  let keyboardNav = $state(false)
  $effect(() => {
    document.documentElement.classList.toggle('keyboard-nav', keyboardNav)
  })

  // The folder in the window title (taskbar, Mission Control, window menus).
  $effect(() => {
    document.title = app.dir ? `${basename(app.dir)} — Reframe` : 'Reframe'
  })

  // Keep the focused cell in view when navigating by keyboard.
  $effect(() => {
    if (app.view !== 'grid' || !app.focus) return
    document.querySelector('.cell.focused')?.scrollIntoView({ block: 'nearest' })
  })

  // The drop tint goes when the drag leaves for anywhere outside the app (including off the
  // window, where nothing is the related target). As a backstop, dragover repeats every ~50ms while
  // files are over the window, so if it stops the drag has gone, however it ended.
  let dropIdle: ReturnType<typeof setTimeout> | undefined
  const endDrop = () => {
    clearTimeout(dropIdle)
    dropping = false
  }
  // The viewport (or the empty state) is the drop zone, and only it tints: the top bar sits under
  // the OS-drawn window controls, which couldn't follow the tint in step.
  const dropZone = {
    ondragover: (e: DragEvent) => {
      e.preventDefault()
      e.dataTransfer!.dropEffect = 'copy'
      dropping = true
      clearTimeout(dropIdle)
      dropIdle = setTimeout(endDrop, 250)
    },
    ondragleave: (e: DragEvent) => {
      if (!(e.currentTarget as Element).contains(e.relatedTarget as Node | null)) endDrop()
    },
    ondrop: (e: DragEvent) => {
      e.preventDefault()
      endDrop()
      const file = e.dataTransfer?.files[0]
      if (file) openFolder(api.pathForFile(file))
    }
  }
  // Elsewhere, files are refused (a not-allowed cursor) rather than opened by the browser, which
  // would navigate the window away from the app.
  const refuse = (e: DragEvent) => {
    if (e.defaultPrevented) return
    e.preventDefault()
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'none'
  }
</script>

<svelte:window
  {onkeydown}
  onkeydowncapture={(e) => e.key === 'Tab' && (keyboardNav = true)}
  onpointerdowncapture={() => (keyboardNav = false)}
  ondragover={refuse}
  ondrop={refuse}
  onpagehide={flush}
/>

<div class="app">
  <TopBar onOpen={openFolder} />
  {#if app.dir}
    <main class="workspace">
      <section class={['content drop-zone', { dropping }]} {...dropZone}>
        <Grid active={app.view === 'grid'} />
        {#if app.view === 'single'}<SingleView />{/if}
      </section>
      <Inspector />
    </main>
  {:else if booted}
    <main class={['empty drop-zone', { dropping }]} {...dropZone}>
      <button class="empty-drop" onclick={() => openFolder()}>
        <Icon name="folder" size={28} />
        <span>Open a folder</span>
        <span class="muted small">or drop one here</span>
      </button>
    </main>
  {/if}
  {#if app.dir && app.assets.length === 0}<div class="empty-hint center">No images or videos in this folder</div>{/if}
  {#if app.exportOpen}<ExportDialog />{/if}
  <Toast />
  <ContextMenu />
</div>

<style>
  .app {
    height: 100%;
    display: grid;
    grid-template-rows: var(--topbar-h) 1fr;
  }

  .workspace {
    display: grid;
    grid-template-columns: 1fr var(--inspector-w);
    min-height: 0;
  }

  .content {
    position: relative;
    min-width: 0;
    min-height: 0;
    background: var(--well);
  }

  /* Dragging files over the viewport: it takes an accent tint, edge to edge. */
  .drop-zone {
    position: relative;
  }

  .drop-zone.dropping::after {
    content: '';
    position: absolute;
    inset: 0;
    background: var(--accent-soft);
    pointer-events: none;
    z-index: 40;
    animation: fade 160ms var(--ease) both;
  }

  .empty {
    display: grid;
    place-items: center;
    background: var(--well);
  }

  .empty-drop {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 48px 72px;
    border: 1px dashed var(--line-strong);
    border-radius: 14px;
    color: var(--text);
    font-size: 13px;
    animation: rise-in 420ms var(--ease) both;
    transition: border-color var(--t-med) var(--ease), background-color var(--t-med) var(--ease), transform var(--t-med) var(--ease);
  }

  .empty-drop :global(svg) {
    color: var(--muted);
    margin-bottom: 4px;
  }

  .empty-drop:hover {
    border-color: var(--faint);
    background: var(--panel);
  }

  .empty-drop:active {
    transform: scale(0.985);
  }

  .empty.dropping .empty-drop {
    border-color: var(--accent);
    transform: scale(1.02);
  }
</style>
