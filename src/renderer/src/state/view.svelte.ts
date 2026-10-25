import type { AssetEntry } from '@shared/types'
import { library } from './library.svelte'
import { layout } from './model/tree'
import { storeCollapsed, storedCollapsed, storedView, storeView, VIEW_DEFAULTS, type ViewPrefs } from './prefs'
import { project } from './project.svelte'

export type Mode = 'grid' | 'single'

/**
 * How the library is shown: grid or single, thumbnail size, the view options (filter, sort,
 * grouping, captions) and folded folders, and the layout that follows from them.
 */
class View {
  mode = $state.raw<Mode>('grid')
  cellSize = $state.raw(220)
  /** Per user, remembered. */
  prefs = $state.raw<ViewPrefs>(storedView())
  /** Folded away in the grid, with everything inside. Remembered per project folder. */
  collapsed = $state.raw<string[]>([])

  // Edits count only when the filter looks at them (Adjusted, Excluded from export), so dragging a
  // slider never re-sorts anything.
  private edits = $derived(this.prefs.filter === 'adjusted' || this.prefs.filter === 'excluded' ? project.board : null)
  /** The folder tree the grid shows, and the visible assets in on-screen order (see tree.ts). */
  readonly layout = $derived(layout(library.assets, this.prefs, this.collapsed, library.skipped, this.edits))

  /** The visible assets, in on-screen order: what the filmstrip, arrow keys and ranges follow. */
  get visible(): AssetEntry[] {
    return this.layout.visible
  }

  /** Changed from the defaults (anything filtered, sorted differently, or folded). */
  get changed(): boolean {
    return this.collapsed.length > 0 || (Object.keys(VIEW_DEFAULTS) as (keyof ViewPrefs)[]).some((k) => this.prefs[k] !== VIEW_DEFAULTS[k])
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
