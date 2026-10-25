import type { IconName } from './icons'

export interface MenuItem {
  id?: string
  label?: string
  icon?: IconName
  shortcut?: string
  /** Present makes it a toggle, shown with a trailing check. */
  checked?: boolean
  enabled?: boolean
  /** Destructive: shown in red. */
  danger?: boolean
  separator?: boolean
}

export type OpenMenu = { x: number; y: number; items: MenuItem[] }

/** The open context menu, if any (see ContextMenu.svelte). */
let open = $state.raw<OpenMenu | null>(null)
let resolver: ((id: string | null) => void) | null = null

export const contextMenu = {
  get open() {
    return open
  }
}

/** Opens the context menu at a point; resolves with the chosen item's id, or null. */
export function showMenu(x: number, y: number, items: MenuItem[]): Promise<string | null> {
  resolver?.(null)
  return new Promise((resolve) => {
    resolver = resolve
    open = { x, y, items }
  })
}

export function closeMenu(id: string | null): void {
  const r = resolver
  resolver = null
  open = null
  r?.(id)
}
