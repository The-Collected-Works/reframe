import type { Artboard } from '@shared/types'
import { bounds, type Placement } from '@shared/framing/framing'
import type { View } from './camera.svelte'

// Where the board sits in a stage, the same for every stage (an asset's, a composition's), so it
// never jumps stepping from one to another. The player and filmstrip float over the bottom of the
// stage, in a reserved band that's the same for images and videos.
const MARGIN_X = 48
const MARGIN_TOP = 40
/** Matches the CSS: .player height, .film-row heights, and the gaps around them. */
const RESERVED = 12 + 64 + 12 + 44 + 12 * 2

/**
 * The board fitted to a `width`×`height` stage, centred. With `media` (media being moved, scaled
 * or rotated, its placement on the board), zoomed out just enough that its corners (the handles)
 * are on screen.
 */
export function fitBoard(width: number, height: number, board: Artboard, media: Placement | null): View {
  const availW = width - MARGIN_X * 2
  const availH = height - MARGIN_TOP - RESERVED
  const fitK = Math.max(0.01, Math.min(availW / board.width, availH / board.height))
  let k = fitK
  if (media) {
    const b = bounds(media)
    const ex = Math.max(board.width / 2, board.width / 2 - b.x, b.x + b.w - board.width / 2)
    const ey = Math.max(board.height / 2, board.height / 2 - b.y, b.y + b.h - board.height / 2)
    k = Math.max(fitK * 0.45, Math.min(fitK, availW / 2 / ex, availH / 2 / ey))
  }
  return { k, bx: MARGIN_X + (availW - board.width * k) / 2, by: MARGIN_TOP + (availH - board.height * k) / 2 }
}
