import { items } from './items.svelte'
import { library } from './library.svelte'
import type { Entry } from './model/items'
import { gridLayout, valueCounts } from './model/tree'
import { storeCollapsed, storedCollapsed, storedView, storeView, VIEW_DEFAULTS, type ViewPrefs } from './prefs'
import { project } from './project.svelte'

export type Mode = 'grid' | 'single'

/**
 * How the library is shown: grid or single, thumbnail size, the view options (filter, sort,
 * grouping, captions) and folded folders, and the grid composition that follows from them.
 */
class View {
  mode = $state.raw<Mode>('grid')
  cellSize = $state.raw(220)
  /** Per user, remembered. */
  prefs = $state.raw<ViewPrefs>(storedView())
  /** Folded away in the grid, with everything inside. Remembered per project folder. */
  collapsed = $state.raw<string[]>([])

  // Edits count only when something hidden is about them (adjusted, left out), so dragging a
  // slider never re-lays out the grid otherwise.
  private edits = $derived(this.prefs.hidden.some((id) => id.startsWith('framing:') || id.startsWith('export:')) ? project.board : null)
  /**
   * Shown whatever the view hides (faded, if it would), so an item changed while it's selected (left
   * out, say, with Excluded from export hidden) doesn't vanish from under the pointer: it goes once it's let go.
   * See `hold`.
   */
  private held = $state.raw<ReadonlySet<string>>(new Set())
  /** The folder tree the grid shows, and the visible assets in on-screen order (see tree.ts). */
  readonly grid = $derived(gridLayout(items.all, this.prefs, this.collapsed, library.skipped, this.edits, this.held))

  /** The visible assets, in on-screen order: what the filmstrip, arrow keys and ranges follow. */
  get visible(): Entry[] {
    return this.grid.visible
  }

  /** Changed from the defaults (anything filtered, sorted differently, or folded). */
  get changed(): boolean {
    const { hidden, ...rest } = this.prefs
    return this.collapsed.length > 0 || hidden.length > 0 || (Object.keys(rest) as (keyof typeof rest)[]).some((k) => rest[k] !== VIEW_DEFAULTS[k])
  }

  /** A newly opened folder: the grid, with that folder's folds. */
  open(dir: string): void {
    this.mode = 'grid'
    this.collapsed = storedCollapsed(dir)
  }

  /** New view options. Nothing's held through them: what they hide goes at once (see `hold`). */
  setPrefs(patch: Partial<ViewPrefs>): void {
    this.held = new Set()
    this.prefs = { ...this.prefs, ...patch }
    storeView(this.prefs)
  }

  /**
   * Holds the selection on screen (what of it is showing, and what's held already), and lets go of
   * the rest: called whenever the selection changes. Pass `fresh` (another artboard) to hold only
   * what's showing.
   */
  hold(selected: string[], fresh = false): void {
    if (fresh) this.held = new Set()
    const showing = new Set(this.visible.map((e) => e.name))
    const next = new Set(selected.filter((n) => showing.has(n) || this.held.has(n)))
    if (next.size !== this.held.size || [...next].some((n) => !this.held.has(n))) this.held = next
  }

  /** How many items have each filter value on the current artboard (see valueCounts). */
  counts(): Map<string, number> {
    return valueCounts(items.all, this.prefs.hidden, project.board)
  }

  setCollapsed(folders: string[]): void {
    this.collapsed = folders
    if (library.dir) storeCollapsed(library.dir, folders)
  }

  /** Default filter, sort, grouping and captions, and every folder open. */
  reset(): void {
    this.setPrefs({ ...VIEW_DEFAULTS })
    this.setCollapsed([])
  }
}

export const view = new View()
