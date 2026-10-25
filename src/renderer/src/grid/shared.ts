import type { Artboard } from '@shared/types'

export const GAP = 8
/** Mat around each frame; matches .cell padding in styles.css. */
export const PAD = 10

/** When the grid last scrolled. Hover previews wait for it to settle (see Cell). */
export const scroll = { last: 0 }

/** What every folder in the grid needs from the grid: column layout, the board, and display options. */
export interface GridLayout {
  cols: number
  cellW: number
  board: Artboard
  active: boolean
  names: boolean
  withFolder: boolean
  /** Grouped by folder: headers, folding. Off, a folder is just its thumbnails. */
  headers: boolean
  rootName: string
}
