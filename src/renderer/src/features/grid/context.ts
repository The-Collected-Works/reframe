import { getContext, setContext } from 'svelte'
import type { Artboard, Clip, CropSettings } from '@shared/types'
import type { Asset } from '../../state/library.svelte'
import type { Entry } from '../../state/model/items'
import type { LayoutScene } from '../scene'

export const GAP = 8
/** Mat around each frame; matches the thumbnail's padding. */
export const PAD = 10

/** When the grid last scrolled. Hover previews wait for it to settle (see HoverPreview). */
export const scroll = { last: 0 }

type At = { x: number; y: number }

/**
 * What the folders and thumbnails inside the grid get from it: the layout, each asset's data, and
 * what to call when something happens. Grid provides it; they don't read app state themselves.
 */
export interface GridModel {
  readonly cols: number
  readonly cellW: number
  readonly board: Artboard
  /** The grid is showing (not behind the single view). */
  readonly active: boolean
  /** File names under thumbnails. */
  readonly names: boolean
  /** Names include their folder (the grid isn't grouped by folder). */
  readonly withFolder: boolean
  /** Grouped by folder: headers and folding. Off, a folder is just its thumbnails. */
  readonly headers: boolean
  /** The open folder's name, for header tooltips. */
  readonly rootName: string
  /** Videos may play on hover (not while the eyedropper is open: it needs the exact thumbnail). */
  readonly previews: boolean

  asset(entry: Entry): Asset
  /** A layout as it sits on the artboard. */
  composite(name: string): LayoutScene | null
  selected(name: string): boolean
  focused(name: string): boolean
  clip(name: string): Clip | undefined
  /** A variant or layout whose name is being edited in place. */
  renaming(name: string): boolean
  /** The new name (null: cancelled). */
  rename(name: string, label: string | null): void

  /** A press on a thumbnail: a plain one keeps a multiple selection (so it can be dragged) and focuses. */
  press(name: string, mode: 'replace' | 'toggle' | 'range'): void
  /** A click that didn't drag. */
  click(name: string): void
  open(): void
  /** Moving the media inside a thumbnail. */
  move(name: string, patch: Partial<CropSettings>): void
  menu(asset: Asset, at: At): void
  /** On screen with nothing loaded yet: load it first. */
  seen(asset: Asset): void
  toggleFolder(folder: string): void
  folderMenu(folder: string, at: At): void
  excludedMenu(folder: string, at: At): void
}

const KEY = Symbol('grid')
export const provideGrid = (model: GridModel): GridModel => setContext(KEY, model)
export const useGrid = (): GridModel => getContext<GridModel>(KEY)
