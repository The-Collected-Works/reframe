import { ALT, MOD, SHIFT } from './keys'

/**
 * Keyboard shortcuts as data. A keymap is a titled list of actions (keys and a label) and notes
 * (gestures and modifiers listed alongside them); the shortcuts panel is drawn from the same
 * keymaps the app runs. What an action does is supplied where its state lives: the app's base
 * keymap through `keyHandler`, a view's through `useKeymap` while it's mounted. Views are asked
 * first, newest first, so one can take a key the base keymap also uses (Esc in the single view
 * deselects before it goes back to the grid).
 *
 * Keys are written like "mod+shift+z", "escape", "space", "arrowleft" or "1": `mod` is ⌘ or Ctrl,
 * the key is `KeyboardEvent.key` in lower case. Shift is ignored for symbols, since it's part of
 * typing them ("mod++" and "mod+=" are both the zoom-in key).
 */

export interface Action {
  /** One key, or several that do the same thing. */
  keys: string | string[]
  label: string
  /** How the keys are listed, when not one by one ("mod+1–9"). */
  show?: string
  /** Also while typing in a field. */
  inFields?: boolean
  /** Also while the app is blocked (see `keyHandler`). */
  always?: boolean
}

/** Listed with the shortcuts, but not handled as keys: "Middle-click", "alt+Scroll", "Pinch". */
export interface Note {
  keys: string | string[]
  label: string
  /** Listed under its own sub-heading ("While dragging"); notes without one follow the actions. */
  section?: string
}

export interface Keymap<A extends string = string> {
  title: string
  actions: Record<A, Action>
  notes?: Note[]
}

export const keymap = <A extends string>(map: Keymap<A>): Keymap<A> => map

/** What an action does; with `when`, only while that holds (otherwise the key falls through). */
export type Handler = ((e: KeyboardEvent) => void) | { run: (e: KeyboardEvent) => void; when: () => boolean }

const MODS = ['mod', 'alt', 'shift'] as const
const symbol = (key: string) => key.length === 1 && !/[a-z0-9]/.test(key)
const list = (keys: string | string[]) => (typeof keys === 'string' ? [keys] : keys)

function split(combo: string): { mods: string[]; key: string } {
  // "mod++": the key itself is a plus.
  const plus = combo.endsWith('++')
  const parts = (plus ? combo.slice(0, -2) : combo).split('+')
  const key = plus ? '+' : parts.pop()!
  return { mods: parts.map((m) => m.toLowerCase()), key }
}

function normalize(combo: string): string {
  const { mods, key } = split(combo)
  const k = key.toLowerCase()
  return [...MODS.filter((m) => mods.includes(m) && !(m === 'shift' && symbol(k))), k].join('+')
}

function comboOf(e: KeyboardEvent): string {
  const key = e.key === ' ' ? 'space' : e.key.toLowerCase()
  const held = { mod: e.metaKey || e.ctrlKey, alt: e.altKey, shift: e.shiftKey && !symbol(key) }
  return [...MODS.filter((m) => held[m]), key].join('+')
}

interface Bound {
  action: Action
  run: (e: KeyboardEvent) => void
  when?: () => boolean
}
type Scope = { keys: Map<string, Bound[]>; when?: () => boolean }

function scope<A extends string>(map: Keymap<A>, handlers: Partial<Record<A, Handler>>, when?: () => boolean): Scope {
  const keys = new Map<string, Bound[]>()
  for (const [id, h] of Object.entries(handlers) as [A, Handler | undefined][]) {
    if (!h) continue
    const action = map.actions[id]
    const bound: Bound = typeof h === 'function' ? { action, run: h } : { action, ...h }
    for (const k of list(action.keys)) {
      const c = normalize(k)
      keys.set(c, [...(keys.get(c) ?? []), bound])
    }
  }
  return { keys, when }
}

const scopes: Scope[] = []

/**
 * Runs a keymap's actions while the calling component is mounted. `handlers` can cover some of
 * them (a view's parts can each supply their own); `when`: only while this holds.
 */
export function useKeymap<A extends string>(map: Keymap<A>, handlers: Partial<Record<A, Handler>>, when?: () => boolean): void {
  $effect(() => {
    const s = scope(map, handlers, when)
    scopes.push(s)
    return () => void scopes.splice(scopes.indexOf(s), 1)
  })
}

/**
 * The window's keydown handler, with the app's base keymap under any views' own. `blocked`: only
 * `always` actions run (a dialog is open, say). `quiet`: plain keys are left alone and only
 * modified ones run (a popover is open and its keys are its own).
 */
export function keyHandler<A extends string>(
  map: Keymap<A>,
  handlers: Record<A, Handler>,
  opts: { blocked?: () => boolean; quiet?: () => boolean } = {}
): (e: KeyboardEvent) => void {
  const root = scope(map, handlers)
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
      for (const b of s.keys.get(combo) ?? []) {
        if ((typing && !b.action.inFields) || (blocked && !b.action.always) || (b.when && !b.when())) continue
        e.preventDefault()
        b.run(e)
        return
      }
    }
  }
}

const NAMES: Record<string, string> = {
  mod: MOD,
  shift: SHIFT,
  alt: ALT,
  escape: 'Esc',
  space: 'Space',
  enter: 'Enter',
  arrowleft: '←',
  arrowright: '→',
  arrowup: '↑',
  arrowdown: '↓',
  '-': '−',
  '=': '+'
}

/**
 * Keys as the shortcuts panel shows them: one chip per key, "/" between alternatives.
 * ["mod+c"] → ["⌘", "C"]; ["arrowleft", "arrowright"] → ["←", "/", "→"].
 */
export function chips(item: Action | Note): string[] {
  const combos = 'show' in item && item.show ? [item.show] : list(item.keys)
  return combos.flatMap((c, i) => {
    const { mods, key } = split(c)
    const keys = [...mods, key].map((k) => NAMES[k.toLowerCase()] ?? (k.length === 1 ? k.toUpperCase() : k))
    return i ? ['/', ...keys] : keys
  })
}
