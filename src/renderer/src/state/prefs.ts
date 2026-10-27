/** What's remembered per user (in local storage): view options, folded folders, preview volume. */

import { FILTER_GROUPS, type FilterKey } from '../config/filters'

export type SortKey = 'name' | 'date' | 'type'

export interface ViewPrefs {
  /** Showing only these (see FILTER_GROUPS); none: everything. */
  filters: FilterKey[]
  sort: SortKey
  /** Sections per folder; off, one continuous grid. */
  group: boolean
  /** File names under thumbnails. */
  names: boolean
}
export const VIEW_DEFAULTS: ViewPrefs = { filters: [], sort: 'name', group: true, names: true }

function read<T>(key: string, fallback: T): T {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? 'null')
    return v ?? fallback
  } catch {
    return fallback
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Not remembered; fine.
  }
}

const FILTERS = FILTER_GROUPS.flat()
const SORTS: SortKey[] = ['name', 'date', 'type']

/** Stored view options, each checked (a value from another version falls back to the default). */
export function storedView(): ViewPrefs {
  const v = read<Partial<ViewPrefs> & { filter?: string }>('reframe.view', {})
  // One filter at a time, before 0.6 ("all", or one of them).
  const filters = Array.isArray(v.filters) ? v.filters : v.filter ? [v.filter] : []
  return {
    filters: filters.filter((f, i): f is FilterKey => FILTERS.includes(f as FilterKey) && filters.indexOf(f) === i),
    sort: SORTS.includes(v.sort as SortKey) ? (v.sort as SortKey) : VIEW_DEFAULTS.sort,
    group: typeof v.group === 'boolean' ? v.group : VIEW_DEFAULTS.group,
    names: typeof v.names === 'boolean' ? v.names : VIEW_DEFAULTS.names
  }
}
export const storeView = (prefs: ViewPrefs): void => write('reframe.view', prefs)

/** Folders folded away in a project folder's grid. */
export function storedCollapsed(dir: string): string[] {
  const v = read<unknown>('reframe.collapsed:' + dir, [])
  return Array.isArray(v) ? v.filter((f): f is string => typeof f === 'string') : []
}
export const storeCollapsed = (dir: string, folders: string[]): void => write('reframe.collapsed:' + dir, folders)

export function storedVolume(): number {
  const v = Number(read<unknown>('reframe.volume', 0.8))
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.8
}
export const storeVolume = (v: number): void => write('reframe.volume', v)

/** The single view's left panel (a composition's outline) open. */
export const storedOutline = (): boolean => read<unknown>('reframe.outline', true) !== false
export const storeOutline = (open: boolean): void => write('reframe.outline', open)
