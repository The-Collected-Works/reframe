import { items } from './items.svelte'
import { library } from './library.svelte'
import type { Entry } from './model/items'
import { gridLayout } from './model/tree'
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

  // Edits count only when a filter looks at them (Adjusted, Excluded from export), so dragging a
  // slider never re-sorts anything.
  private edits = $derived(this.prefs.filters.some((f) => f === 'adjusted' || f === 'excluded') ? project.board : null)
  /** The folder tree the grid shows, and the visible assets in on-screen order (see tree.ts). */
  readonly grid = $derived(gridLayout(items.all, this.prefs, this.collapsed, library.skipped, this.edits))

  /** The visible assets, in on-screen order: what the filmstrip, arrow keys and ranges follow. */
  get visible(): Entry[] {
    return this.grid.visible
  }

  /** Changed from the defaults (anything filtered, sorted differently, or folded). */
  get changed(): boolean {
    const { filters, ...rest } = this.prefs
    return this.collapsed.length > 0 || filters.length > 0 || (Object.keys(rest) as (keyof typeof rest)[]).some((k) => rest[k] !== VIEW_DEFAULTS[k])
  }

  /** A newly opened folder: the grid, with that folder's folds. */
  open(dir: string): void {
    this.mode = 'grid'
    this.collapsed = storedCollapsed(dir)
  }

  setPrefs(patch: Partial<ViewPrefs>): void {
    this.prefs = { ...this.prefs, ...patch }
    storeView(this.prefs)
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
