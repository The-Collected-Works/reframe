<script lang="ts">
  import { api } from '../media'
  import type { AppMenuItem } from '../store.svelte'
  import Icon from './Icon.svelte'

  let { x, y, items, closing, onChoose }: { x: number; y: number; items: AppMenuItem[]; closing: boolean; onChoose: (id: string | null) => void } = $props()

  let el: HTMLDivElement
  let pos = $state<{ left: number; top: number; origin: string } | null>(null)
  let active = $state(-1)
  const usable = $derived(items.map((it, i) => (!it.separator && it.enabled !== false ? i : -1)).filter((i) => i >= 0))

  // Open at the pointer, flipping left/up when it would leave the window.
  $effect(() => {
    const w = el.offsetWidth
    const h = el.offsetHeight
    const left = x + w > window.innerWidth - 8 ? Math.max(8, x - w) : x
    const top = y + h > window.innerHeight - 8 ? Math.max(8, y - h) : y
    pos = { left, top, origin: `${left < x ? 'right' : 'left'} ${top < y ? 'bottom' : 'top'}` }
  })

  // Keyboard: ↑ ↓ move, Enter chooses, Esc closes. Any click elsewhere, scroll or blur closes.
  $effect(() => {
    if (closing) return
    const key = (e: KeyboardEvent) => {
      e.stopImmediatePropagation()
      e.preventDefault()
      if (e.key === 'Escape') return onChoose(null)
      if (e.key === 'Enter' && active >= 0) return onChoose(items[active].id ?? null)
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
      // From nothing highlighted, ↓ starts at the first item and ↑ at the last.
      const at = usable.indexOf(active)
      const next =
        e.key === 'ArrowDown' ? usable[(at + 1) % usable.length] : usable[at < 0 ? usable.length - 1 : (at - 1 + usable.length) % usable.length]
      active = next ?? -1
    }
    const away = (e: Event) => {
      if (!el.contains(e.target as Node)) onChoose(null)
    }
    const close = () => onChoose(null)
    window.addEventListener('keydown', key, true)
    window.addEventListener('pointerdown', away, true)
    window.addEventListener('wheel', close, { capture: true, passive: true })
    window.addEventListener('blur', close)
    window.addEventListener('resize', close)
    const offMove = api.onWindowMoving(close)
    return () => {
      offMove()
      window.removeEventListener('keydown', key, true)
      window.removeEventListener('pointerdown', away, true)
      window.removeEventListener('wheel', close, true)
      window.removeEventListener('blur', close)
      window.removeEventListener('resize', close)
    }
  })
</script>

<div
  bind:this={el}
  role="menu"
  tabindex="-1"
  class={'ctx-menu' + (closing ? ' closing' : '')}
  style={pos ? `left: ${pos.left}px; top: ${pos.top}px; transform-origin: ${pos.origin}` : 'visibility: hidden'}
  oncontextmenu={(e) => e.preventDefault()}
  onpointerleave={() => (active = -1)}
>
  {#each items as it, i (i)}
    {#if it.separator}
      <div class="ctx-sep"></div>
    {:else}
      <button
        role="menuitem"
        class={'ctx-item' + (i === active ? ' active' : '') + (it.danger ? ' danger' : '')}
        disabled={it.enabled === false}
        onpointerenter={() => (active = it.enabled === false ? -1 : i)}
        onclick={() => onChoose(it.id ?? null)}
      >
        <span class="ctx-icon">{#if it.icon}<Icon name={it.icon} size={15} />{/if}</span>
        <span class="ctx-label">{it.label}</span>
        {#if it.shortcut}<span class="ctx-key">{it.shortcut}</span>{/if}
        {#if it.checked !== undefined}<span class="ctx-check">{#if it.checked}<Icon name="check" size={14} />{/if}</span>{/if}
      </button>
    {/if}
  {/each}
</div>
