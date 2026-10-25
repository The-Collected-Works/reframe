<script lang="ts">
  import type { Attachment } from 'svelte/attachments'
  import { api } from '../lib/bridge'
  import { closing } from '../lib/motion'
  import Icon from './Icon.svelte'
  import { contextMenu, type OpenMenu } from './menu.svelte'

  let { menu, onChoose }: { menu: OpenMenu; onChoose: (id: string | null) => void } = $props()
  // Fixed for the menu's life (a new menu is a new instance), and kept while it animates out.
  // svelte-ignore state_referenced_locally
  const self = menu
  const { x, y, items } = self

  let el: HTMLDivElement
  let active = $state(-1)
  const usable = items.map((it, i) => (!it.separator && it.enabled !== false ? i : -1)).filter((i) => i >= 0)
  // Only while it's the open menu: one animating out (closed, or replaced by another) is inert.
  const open = () => contextMenu.open === self
  const choose = (id: string | null) => open() && onChoose(id)

  // Open at the pointer, flipping left/up when it would leave the window.
  const place: Attachment<HTMLElement> = (node) => {
    const w = node.offsetWidth
    const h = node.offsetHeight
    const left = x + w > window.innerWidth - 8 ? Math.max(8, x - w) : x
    const top = y + h > window.innerHeight - 8 ? Math.max(8, y - h) : y
    Object.assign(node.style, {
      left: `${left}px`,
      top: `${top}px`,
      transformOrigin: `${left < x ? 'right' : 'left'} ${top < y ? 'bottom' : 'top'}`,
      visibility: ''
    })
  }

  // Keyboard: ↑ ↓ move, Enter chooses, Esc closes. Any click elsewhere, scroll or blur closes.
  function onkeydowncapture(e: KeyboardEvent) {
    if (!open()) return
    e.stopImmediatePropagation()
    e.preventDefault()
    if (e.key === 'Escape') return choose(null)
    if (e.key === 'Enter' && active >= 0) return choose(items[active].id ?? null)
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    // From nothing highlighted, ↓ starts at the first item and ↑ at the last.
    const at = usable.indexOf(active)
    const next = e.key === 'ArrowDown' ? usable[(at + 1) % usable.length] : usable[at < 0 ? usable.length - 1 : (at - 1 + usable.length) % usable.length]
    active = next ?? -1
  }
  const away = (e: Event) => !el.contains(e.target as Node) && choose(null)
  const close = () => choose(null)
  $effect(() => api.onWindowMoving(close))
</script>

<svelte:window {onkeydowncapture} onpointerdowncapture={away} onwheelcapture={close} onblur={close} onresize={close} />

<div
  bind:this={el}
  role="menu"
  tabindex="-1"
  class="ctx-menu"
  style="visibility: hidden"
  {@attach place}
  out:closing|global={{ duration: 110 }}
  oncontextmenu={(e) => e.preventDefault()}
  onpointerleave={() => (active = -1)}
>
  {#each items as it, i (i)}
    {#if it.separator}
      <div class="ctx-sep"></div>
    {:else}
      <button
        role="menuitem"
        class={['ctx-item', { active: i === active, danger: it.danger }]}
        disabled={it.enabled === false}
        onpointerenter={() => (active = it.enabled === false ? -1 : i)}
        onclick={() => choose(it.id ?? null)}
      >
        <span class="ctx-icon"
          >{#if it.icon}<Icon name={it.icon} size={15} />{/if}</span
        >
        <span class="ctx-label">{it.label}</span>
        {#if it.shortcut}<span class="ctx-key">{it.shortcut}</span>{/if}
        {#if it.checked !== undefined}<span class="ctx-check"
            >{#if it.checked}<Icon name="check" size={14} />{/if}</span
          >{/if}
      </button>
    {/if}
  {/each}
</div>

<style>
  .ctx-menu {
    position: fixed;
    z-index: 95;
    min-width: 220px;
    padding: 5px;
    border-radius: 10px;
    background: rgba(32, 32, 36, 0.92);
    backdrop-filter: blur(20px) saturate(150%);
    box-shadow:
      0 0 0 1px rgba(255, 255, 255, 0.06),
      0 14px 40px rgba(0, 0, 0, 0.5);
    -webkit-app-region: no-drag;
    animation: pop-in 130ms var(--ease) both;
  }

  .ctx-menu:global(.closing) {
    animation: pop-out 120ms var(--ease) forwards;
    pointer-events: none;
  }

  .ctx-item {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    height: var(--control);
    padding: 0 10px 0 8px;
    border-radius: 6px;
    text-align: left;
    color: var(--text);
  }

  .ctx-item.active {
    background: var(--tint-2);
  }

  .ctx-item.danger,
  .ctx-item.danger .ctx-icon,
  .ctx-item.danger.active .ctx-icon {
    color: var(--danger);
  }

  /* Destructive items highlight in their own colour rather than neutral white. */
  .ctx-item.danger.active {
    background: rgba(255, 107, 107, 0.12);
  }

  .ctx-icon {
    display: grid;
    place-items: center;
    width: 16px;
    color: var(--muted);
  }

  .ctx-item.active .ctx-icon {
    color: var(--text);
  }

  .ctx-label {
    flex: 1;
    white-space: nowrap;
  }

  .ctx-key {
    color: var(--faint);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  }

  .ctx-check {
    display: grid;
    place-items: center;
    width: 16px;
    color: var(--accent);
  }

  .ctx-sep {
    height: 1px;
    margin: 5px 8px;
    background: var(--tint-2);
  }
</style>
