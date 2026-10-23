import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { closeMenu } from '../menus'
import { api } from '../media'
import { usePresence } from '../motion'
import { useStore, type AppMenuItem } from '../store'
import { Icon } from './ui'

/** The app's own context menu: same surface as its popovers, with icons, shortcuts and checks. */
export function ContextMenu() {
  const menu = useStore((s) => s.contextMenu)
  // The last menu stays rendered while it animates out.
  const last = useRef(menu)
  if (menu) last.current = menu
  const { mounted, closing } = usePresence(!!menu, 110)
  const m = last.current
  return mounted && m ? <MenuView key={`${m.x},${m.y}`} x={m.x} y={m.y} items={m.items} closing={closing} /> : null
}

function MenuView({ x, y, items, closing }: { x: number; y: number; items: AppMenuItem[]; closing: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number; origin: string } | null>(null)
  const [active, setActive] = useState(-1)
  const usable = items.map((it, i) => (!it.separator && it.enabled !== false ? i : -1)).filter((i) => i >= 0)

  // Open at the pointer, flipping left/up when it would leave the window.
  useLayoutEffect(() => {
    const el = ref.current!
    const w = el.offsetWidth
    const h = el.offsetHeight
    const left = x + w > window.innerWidth - 8 ? Math.max(8, x - w) : x
    const top = y + h > window.innerHeight - 8 ? Math.max(8, y - h) : y
    setPos({ left, top, origin: `${left < x ? 'right' : 'left'} ${top < y ? 'bottom' : 'top'}` })
  }, [x, y])

  // Keyboard: ↑ ↓ move, Enter chooses, Esc closes. Any click elsewhere, scroll or blur closes.
  const activeRef = useRef(active)
  activeRef.current = active
  useEffect(() => {
    if (closing) return
    const key = (e: KeyboardEvent) => {
      e.stopImmediatePropagation()
      e.preventDefault()
      if (e.key === 'Escape') return closeMenu(null)
      if (e.key === 'Enter' && activeRef.current >= 0) return closeMenu(items[activeRef.current].id ?? null)
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
      // From nothing highlighted, ↓ starts at the first item and ↑ at the last.
      const at = usable.indexOf(activeRef.current)
      const next =
        e.key === 'ArrowDown'
          ? usable[(at + 1) % usable.length]
          : usable[at < 0 ? usable.length - 1 : (at - 1 + usable.length) % usable.length]
      setActive(next ?? -1)
    }
    const away = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) closeMenu(null)
    }
    const close = () => closeMenu(null)
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
  }, [items, closing])

  return (
    <div
      ref={ref}
      role="menu"
      className={'ctx-menu' + (closing ? ' closing' : '')}
      style={pos ? { left: pos.left, top: pos.top, transformOrigin: pos.origin } : { visibility: 'hidden' }}
      onContextMenu={(e) => e.preventDefault()}
      onPointerLeave={() => setActive(-1)}
    >
      {items.map((it, i) =>
        it.separator ? (
          <div key={i} className="ctx-sep" />
        ) : (
          <button
            key={i}
            role="menuitem"
            className={'ctx-item' + (i === active ? ' active' : '') + (it.danger ? ' danger' : '')}
            disabled={it.enabled === false}
            onPointerEnter={() => setActive(it.enabled === false ? -1 : i)}
            onClick={() => closeMenu(it.id ?? null)}
          >
            <span className="ctx-icon">{it.icon && <Icon name={it.icon} size={15} />}</span>
            <span className="ctx-label">{it.label}</span>
            {it.shortcut && <span className="ctx-key">{it.shortcut}</span>}
            {it.checked !== undefined && <span className="ctx-check">{it.checked && <Icon name="check" size={14} />}</span>}
          </button>
        )
      )}
    </div>
  )
}
