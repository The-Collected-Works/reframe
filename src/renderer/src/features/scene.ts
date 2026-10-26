import { gridDuration, layoutGrid, slotKey, slotsOf, type CellSource, type GridLayout } from '@shared/grid'
import { resolveSettings } from '@shared/layout'
import type { Artboard, CropSettings, GridItem, GridSlot } from '@shared/types'
import { items } from '../state/items.svelte'
import type { Asset } from '../state/library.svelte'
import { gridOf } from '../state/model/items'
import { clipFor } from '../state/model/project'
import { project } from '../state/project.svelte'

/**
 * A grid as it sits on an artboard: its layout, and for each cell the item it shows (with what's
 * been loaded about it) and how that's framed there. Read inside an effect or derived, it follows
 * the project and the loaded thumbnails.
 */
export interface GridScene {
  key: string
  grid: GridItem
  layout: GridLayout
  cells: Map<string, { asset: Asset | undefined; settings: CropSettings }>
  /** Seconds; 0 when nothing in it moves. */
  duration: number
  /** Changes whenever the picture would: compare to skip redrawing. */
  stamp: string
}

export function gridScene(key: string, board: Artboard): GridScene | null {
  const grid = gridOf(project.file, key)
  if (!grid) return null
  const layout = layoutGrid(grid, board.width, board.height, board.splits?.[key])
  const cells = new Map<string, { asset: Asset | undefined; settings: CropSettings }>()
  for (const c of layout.cells)
    cells.set(c.slot.id, { asset: c.slot.item ? items.asset(c.slot.item) : undefined, settings: resolveSettings(board, slotKey(key, c.slot.id)) })
  const lengths = slotsOf(grid.root).flatMap((s) => {
    const a = s.item ? items.asset(s.item) : undefined
    if (a?.kind !== 'video' || !a.duration) return []
    const c = clipFor(project.file, a.name, a.duration)
    return [c.end - c.start]
  })
  const stamp = JSON.stringify([
    grid.radius,
    grid.bgColor,
    layout.cells.map((c) => {
      const cell = cells.get(c.slot.id)!
      return [c.rect, cell.settings, cell.asset?.path, cell.asset?.mtime, cell.asset?.w, !!cell.asset?.thumb]
    })
  ])
  return { key, grid, layout, cells, duration: gridDuration(grid.duration, lengths), stamp }
}

/** Each cell's thumbnail, framed: what the grid view and filmstrip draw a grid from. */
export const thumbSource =
  (scene: GridScene) =>
  (slot: GridSlot): CellSource | null => {
    const c = scene.cells.get(slot.id)
    return c?.asset?.thumb ? { src: c.asset.thumb, sw: c.asset.w, sh: c.asset.h, settings: c.settings } : null
  }
