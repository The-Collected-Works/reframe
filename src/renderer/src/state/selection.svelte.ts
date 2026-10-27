import { view } from './view.svelte'

/**
 * Which assets are selected, and which of them has focus (the one the single view shows and the
 * inspector describes). Ranges and stepping follow what the grid shows, in on-screen order.
 */
class Selection {
  names = $state.raw<string[]>([])
  focus = $state.raw<string | null>(null)
  private index = $derived(new Set(this.names))
  private nodesIn = $state.raw<{ composition: string; ids: string[] } | null>(null)

  /**
   * With a composition in focus, the parts of it selected: cells or groups of them (none: the
   * composition itself). The last is the one the editor's chrome is for (see `node`).
   */
  get nodes(): string[] {
    return this.nodesIn && this.nodesIn.composition === this.focus ? this.nodesIn.ids : []
  }

  set nodes(ids: string[]) {
    this.nodesIn = ids.length && this.focus ? { composition: this.focus, ids } : null
  }

  /** The part of the composition in focus selected (the last, with several). Setting it selects just it. */
  get node(): string | null {
    const ids = this.nodes
    return ids[ids.length - 1] ?? null
  }

  set node(id: string | null) {
    this.nodes = id ? [id] : []
  }

  /** A part of the composition added to the selection, or taken out of it (shift-click). */
  toggleNode(id: string): void {
    const ids = this.nodes
    this.nodes = ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]
  }

  has(name: string): boolean {
    return this.index.has(name)
  }

  get size(): number {
    return this.names.length
  }

  /**
   * A click: `replace` selects just this; `toggle` adds or removes it; `range` (shift) covers what's
   * on screen from the focus to here (or acts as a plain click if the focus is out of sight).
   */
  select(name: string, mode: 'replace' | 'toggle' | 'range' = 'replace'): void {
    const order = view.visible.map((a) => a.name)
    if (mode === 'toggle') {
      const has = this.has(name)
      this.names = has ? this.names.filter((n) => n !== name) : [...this.names, name]
      this.focus = has ? (this.names[this.names.length - 1] ?? null) : name
    } else if (mode === 'range' && this.focus && order.includes(this.focus)) {
      const [a, b] = [order.indexOf(this.focus), order.indexOf(name)].sort((x, y) => x - y)
      this.names = order.slice(a, b + 1)
    } else {
      this.names = [name]
      this.focus = name
    }
  }

  /** Selects exactly `names`, keeping the focus if it's among them. */
  set(names: string[]): void {
    this.names = names
    this.focus = this.focus && names.includes(this.focus) ? this.focus : (names[0] ?? null)
  }

  selectAll(): void {
    this.names = view.visible.map((a) => a.name)
  }

  /** Nothing selected. `keepFocus`: the single view keeps showing the focused asset. */
  clear(keepFocus = false): void {
    this.names = []
    if (!keepFocus) this.focus = null
  }

  /** To the next (or previous) visible asset, alone. */
  step(delta: number): void {
    const assets = view.visible
    if (!assets.length) return
    const i = this.focus ? assets.findIndex((a) => a.name === this.focus) : -1
    const next = assets[Math.max(0, Math.min(assets.length - 1, i + delta))].name
    this.names = [next]
    this.focus = next
  }

  /** Drops whatever isn't in `keep`; the focus moves to the first that's left. */
  keepOnly(keep: Set<string>): void {
    this.names = this.names.filter((n) => keep.has(n))
    this.focus = this.focus && keep.has(this.focus) ? this.focus : (this.names[0] ?? null)
  }
}

export const selection = new Selection()
