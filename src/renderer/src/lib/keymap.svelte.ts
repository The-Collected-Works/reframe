/**
 * Keyboard shortcuts as data. The app has a base keymap; views add their own while they're
 * mounted (`useKeymap`), and those are asked first, newest first, so a view can take a key the
 * base map also uses (Esc in the single view deselects before it goes back to the grid).
 *
 * Keys are written like "mod+shift+z", "escape", "space", "arrowleft" or "1": `mod` is ⌘ or Ctrl,
 * the key is `KeyboardEvent.key` in lower case. Shift is ignored for symbols, since it's part of
 * typing them ("mod++" and "mod+=" are both the zoom-in key).
 */

export interface Binding {
  /** One key, or several that do the same thing. */
  keys: string | string[]
  run: (e: KeyboardEvent) => void
  /** Only while this holds; otherwise the key falls through to the next keymap. */
  when?: () => boolean
  /** Also while typing in a field. */
  inFields?: boolean
  /** Also while the app is blocked (see `keyHandler`). */
  always?: boolean
}

interface Scope {
  bindings: Map<string, Binding[]>
  when?: () => boolean
}

const MODS = ['mod', 'alt', 'shift'] as const
const symbol = (key: string) => key.length === 1 && !/[a-z0-9]/.test(key)

function normalize(combo: string): string {
  const parts = combo.toLowerCase().split('+')
  // "mod++": the key itself is a plus.
  const key = combo.endsWith('++') ? '+' : parts.pop()!
  return [...MODS.filter((m) => parts.includes(m) && !(m === 'shift' && symbol(key))), key].join('+')
}

function comboOf(e: KeyboardEvent): string {
  const key = e.key === ' ' ? 'space' : e.key.toLowerCase()
  const held = { mod: e.metaKey || e.ctrlKey, alt: e.altKey, shift: e.shiftKey && !symbol(key) }
  return [...MODS.filter((m) => held[m]), key].join('+')
}

function scope(bindings: Binding[], when?: () => boolean): Scope {
  const map = new Map<string, Binding[]>()
  for (const b of bindings) {
    for (const k of typeof b.keys === 'string' ? [b.keys] : b.keys) {
      const c = normalize(k)
      map.set(c, [...(map.get(c) ?? []), b])
    }
  }
  return { bindings: map, when }
}

const scopes: Scope[] = []

/** Adds a keymap while the calling component is mounted. `when`: only while this holds. */
export function useKeymap(bindings: Binding[], when?: () => boolean): void {
  $effect(() => {
    const s = scope(bindings, when)
    scopes.push(s)
    return () => void scopes.splice(scopes.indexOf(s), 1)
  })
}

/**
 * The window's keydown handler, with the app's base keymap under any views' own. `blocked`: only
 * `always` bindings run (a dialog is open, say). `quiet`: plain keys are left alone and only
 * modified ones run (a popover is open and its keys are its own).
 */
export function keyHandler(base: Binding[], opts: { blocked?: () => boolean; quiet?: () => boolean } = {}): (e: KeyboardEvent) => void {
  const root = scope(base)
  return (e) => {
    if (e.defaultPrevented) return
    const combo = comboOf(e)
    const target = e.target as HTMLElement
    const typing = !!target.closest?.('input, textarea, select, [contenteditable]')
    // A focused button keeps Space and Enter for itself.
    if ((combo === 'space' || combo === 'enter') && target.closest?.('button')) return
    const blocked = opts.blocked?.() ?? false
    if (!blocked && !combo.includes('+') && opts.quiet?.()) return
    for (const s of [...scopes].reverse().concat(root)) {
      if (s.when && !s.when()) continue
      for (const b of s.bindings.get(combo) ?? []) {
        if ((typing && !b.inFields) || (blocked && !b.always) || (b.when && !b.when())) continue
        e.preventDefault()
        b.run(e)
        return
      }
    }
  }
}
