<!--
  The artboard tabs. Clicking another tab switches to it. On the current one, clicking its name
  renames it in place (Enter or clicking away saves, Esc cancels), and clicking the rest of it
  opens its editor (the size). Middle-click deletes one, like closing a browser tab (it undoes).
  When they overflow: fades on whichever side has more, the wheel scrolls them sideways, and
  click-dragging pans (a click that doesn't move still picks a tab). The current tab is kept in view.
-->
<script lang="ts">
  import type { Attachment } from 'svelte/attachments'
  import type { Artboard } from '@shared/types'
  import { trackPointer } from '../../lib/drag'
  import { hint } from '../../lib/keymap.svelte'
  import { reducedMotion } from '../../lib/motion'
  import { Icon } from '../../ui'
  import { GLOBAL } from '../keymaps'
  import ArtboardEditor from './ArtboardEditor.svelte'

  type Patch = Partial<Pick<Artboard, 'name' | 'width' | 'height'>>
  let {
    boards,
    current,
    editing,
    renaming,
    onSelect,
    onEdit,
    onRename,
    onMenu,
    onChange,
    onDuplicate,
    onDelete
  }: {
    boards: Artboard[]
    /** The current artboard's id. */
    current: string
    /** The artboard whose editor is open, if any. */
    editing: string | null
    /** The artboard whose tab is being renamed, if any. */
    renaming: string | null
    onSelect: (id: string) => void
    onEdit: (id: string | null) => void
    onRename: (id: string | null) => void
    onMenu: (id: string, at: { x: number; y: number }) => void
    onChange: (id: string, patch: Patch) => void
    onDuplicate: (id: string) => void
    onDelete: (id: string) => void
  } = $props()

  let el: HTMLElement
  let dragging = $state(false)
  let fade = $state({ left: false, right: false })
  const count = $derived(boards.length)

  // Compares the outermost tabs with the strip's edges rather than scroll arithmetic, which can be
  // off by a fraction of a pixel at fractional display scaling.
  function update() {
    const tabs = el.querySelectorAll('.tab-anchor')
    if (!tabs.length) return (fade = { left: false, right: false })
    const strip = el.getBoundingClientRect()
    fade = {
      left: tabs[0].getBoundingClientRect().left < strip.left - 1,
      right: tabs[tabs.length - 1].getBoundingClientRect().right > strip.right + 1
    }
  }
  // Again whenever the strip or the tabs inside it change size (tabs added, removed, renamed).
  const watchSize: Attachment<HTMLElement> = (node) => {
    const ro = new ResizeObserver(update)
    ro.observe(node)
    void count
    node.querySelectorAll('.tab-anchor').forEach((t) => ro.observe(t))
    return () => ro.disconnect()
  }
  function onwheel(e: WheelEvent) {
    const d = Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX
    if (!d || el.scrollWidth <= el.clientWidth) return
    e.preventDefault()
    el.scrollLeft += d
  }

  const intoView = (tab: Element | null | undefined) =>
    tab?.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' })
  $effect(() => {
    void current
    void count
    intoView(el.querySelector('.tab.on'))
  })

  // The rename field: focused with its text selected; Enter or leaving it saves, Esc cancels.
  // Finishes once, since removing the field also blurs it.
  const renameField =
    (b: Artboard): Attachment<HTMLInputElement> =>
    (input) => {
      let done = false
      const finish = (save: boolean) => {
        if (done) return
        done = true
        const name = input.value.trim()
        onRename(null)
        if (save && name && name !== b.name) onChange(b.id, { name })
      }
      const onkeydown = (e: KeyboardEvent) => {
        // Kept from the app's shortcuts (Esc would also deselect).
        e.stopPropagation()
        if (e.key === 'Enter') finish(true)
        else if (e.key === 'Escape') finish(false)
      }
      const onblur = () => finish(true)
      input.addEventListener('keydown', onkeydown)
      input.addEventListener('blur', onblur)
      input.focus()
      input.select()
      return () => {
        input.removeEventListener('keydown', onkeydown)
        input.removeEventListener('blur', onblur)
      }
    }
  let swallowClick = false
  const onpointerdown = (e: PointerEvent) => {
    if (e.button !== 0 || el.scrollWidth <= el.clientWidth) return
    const left0 = el.scrollLeft
    trackPointer(e, {
      slop: 4,
      start: () => (dragging = true),
      move: (ev) => (el.scrollLeft = left0 - (ev.clientX - e.clientX)),
      end: (dragged) => {
        dragging = false
        swallowClick = dragged
      }
    })
  }
  const onclickcapture = (e: MouseEvent) => {
    if (swallowClick) {
      swallowClick = false
      return e.stopPropagation()
    }
    // Any clicked tab (including the active one, which opens its editor) comes fully into view.
    intoView((e.target as Element).closest('.tab'))
  }
</script>

<nav
  bind:this={el}
  class={['strip', { 'fade-left': fade.left, 'fade-right': fade.right, dragging }]}
  {@attach watchSize}
  onscroll={update}
  onscrollend={update}
  {onwheel}
  {onpointerdown}
  {onclickcapture}
>
  {#each boards as b, i (b.id)}
    <div class="tab-anchor">
      {#if renaming === b.id}
        <div class={['tab', 'renaming', { on: b.id === current }]}>
          <input class="rename" value={b.name} aria-label="Artboard name" spellcheck="false" {@attach renameField(b)} />
          <span class="dims">{b.width}×{b.height}</span>
          <span class="chevron" aria-hidden="true"><Icon name="chevronDown" size={12} /></span>
        </div>
      {:else}
        <button
          class={['tab', { on: b.id === current, editing: editing === b.id }]}
          title={b.id === current ? 'Edit artboard' : i < 9 ? hint(GLOBAL.actions.board, i) : undefined}
          onclick={(e) => {
            if (b.id !== current) return onSelect(b.id)
            if ((e.target as Element).closest('.name')) {
              onEdit(null)
              onRename(b.id)
            } else onEdit(editing === b.id ? null : b.id)
          }}
          onmousedown={(e) => e.button === 1 && e.preventDefault()}
          onauxclick={(e) => e.button === 1 && boards.length > 1 && onDelete(b.id)}
          oncontextmenu={(e) => {
            e.preventDefault()
            onMenu(b.id, { x: e.clientX, y: e.clientY })
          }}
        >
          <span class="name" title={b.id === current ? 'Rename' : undefined}>{b.name}</span>
          <span class="dims">{b.width}×{b.height}</span>
          <!-- The current tab opens its editor; the chevron says so. Every tab reserves its space, so
               switching tabs doesn't change any widths. -->
          <span class="chevron" aria-hidden="true"><Icon name="chevronDown" size={12} /></span>
        </button>
      {/if}
      <ArtboardEditor
        board={b}
        open={editing === b.id}
        canDelete={boards.length > 1}
        onClose={() => onEdit(null)}
        onChange={(patch) => onChange(b.id, patch)}
        onDuplicate={() => onDuplicate(b.id)}
        onDelete={() => onDelete(b.id)}
      />
    </div>
  {/each}
</nav>

<style>
  .strip {
    position: relative;
    display: flex;
    align-items: center;
    gap: 2px;
    min-width: 0;
    overflow-x: auto;
    scrollbar-width: none;
    /* Tabs scrolled into view stop clear of the 32px fades. */
    scroll-padding-inline: 40px;
    /* Fades appear only on a side that has more tabs. */
    --fl: 0px;
    --fr: 0px;
    mask-image: linear-gradient(to right, transparent, #000 var(--fl), #000 calc(100% - var(--fr)), transparent);
  }

  .strip > * {
    -webkit-app-region: no-drag;
  }

  .fade-left {
    --fl: 32px;
  }

  .fade-right {
    --fr: 32px;
  }

  .dragging {
    cursor: grabbing;
  }

  .dragging .tab {
    pointer-events: none;
  }

  .tab-anchor {
    position: relative;
  }

  .tab {
    position: relative;
    z-index: 1;
    display: flex;
    align-items: center;
    gap: 7px;
    height: var(--control);
    padding: 0 10px;
    border-radius: var(--radius);
    color: var(--muted);
    white-space: nowrap;
    /* Highlights cross-fade: the old one dissolves while the new one comes up. */
    transition:
      background-color 260ms cubic-bezier(0.4, 0, 0.2, 1),
      color 260ms cubic-bezier(0.4, 0, 0.2, 1),
      transform var(--t-fast) var(--ease);
  }

  /* Hover gets a lighter tint than the current pill, so it reads even when the tab is half-faded. */
  .tab:not(.on):hover {
    color: var(--text);
    background: var(--tint-1);
  }

  .tab.on {
    color: var(--text);
    background: var(--tint-2);
  }

  /* Renaming: the name becomes a field the width of its text, in the tab's own type. */
  .renaming {
    color: var(--text);
    background: var(--tint-2);
    box-shadow: inset 0 0 0 1px var(--accent);
  }

  .rename {
    field-sizing: content;
    min-width: 2ch;
    max-width: 240px;
    padding: 0;
    border: 0;
    outline: 0;
    background: none;
    color: inherit;
    font: inherit;
  }

  .rename::selection {
    background: color-mix(in srgb, var(--accent) 40%, transparent);
  }

  /* On the current tab the name is the rename target. */
  .on .name {
    cursor: text;
  }

  .dims {
    font-size: 11px;
    color: var(--faint);
    font-variant-numeric: tabular-nums;
  }

  .on .dims {
    color: var(--muted);
  }

  .chevron {
    display: grid;
    place-items: center;
    margin: 0 -3px 0 -2px;
    color: var(--muted);
    align-self: center;
    opacity: 0;
    transition: opacity var(--t-med) var(--ease);
  }

  .on .chevron {
    opacity: 1;
  }

  .chevron :global(svg) {
    transition: transform var(--t-med) var(--ease);
  }

  /* Flips while the editor is open: clicking again closes it. */
  .editing .chevron :global(svg) {
    transform: rotate(180deg);
  }
</style>
