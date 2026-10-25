<script lang="ts">
  import type { Attachment } from 'svelte/attachments'
  import { api } from '../media'
  import { closing } from '../motion'
  import { app, type AppMenuItem } from '../store.svelte'
  import Icon from './Icon.svelte'

  let { menu, onChoose }: { menu: { x: number; y: number; items: AppMenuItem[] }; onChoose: (id: string | null) => void } = $props()
  // Fixed for the menu's life (a new menu is a new instance), and kept while it animates out.
  // svelte-ignore state_referenced_locally
  const self = menu
  const { x, y, items } = self

  let el: HTMLDivElement
  let active = $state(-1)
  const usable = items.map((it, i) => (!it.separator && it.enabled !== false ? i : -1)).filter((i) => i >= 0)
  // Only while it's the open menu: one animating out (closed, or replaced by another) is inert.
  const open = () => app.contextMenu === self
  const choose = (id: string | null) => open() && onChoose(id)

  // Open at the pointer, flipping left/up when it would leave the window.
  const place: Attachment<HTMLElement> = (node) => {
    const w = node.offsetWidth
    const h = node.offsetHeight
    const left = x + w > window.innerWidth - 8 ? Math.max(8, x - w) : x
    const top = y + h > window.innerHeight - 8 ? Math.max(8, y - h) : y
    Object.assign(node.style, { left: `${left}px`, top: `${top}px`, transformOrigin: `${left < x ? 'right' : 'left'} ${top < y ? 'bottom' : 'top'}`, visibility: '' })
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
        <span class="ctx-icon">{#if it.icon}<Icon name={it.icon} size={15} />{/if}</span>
        <span class="ctx-label">{it.label}</span>
        {#if it.shortcut}<span class="ctx-key">{it.shortcut}</span>{/if}
        {#if it.checked !== undefined}<span class="ctx-check">{#if it.checked}<Icon name="check" size={14} />{/if}</span>{/if}
      </button>
    {/if}
  {/each}
</div>
