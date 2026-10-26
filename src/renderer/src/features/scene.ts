import { layoutDuration, arrange, slotKey, slotsOf, type CellSource, type Arrangement } from '@shared/arrangement'
import { resolveSettings } from '@shared/layout'
import type { Artboard, CropSettings, LayoutItem, Slot } from '@shared/types'
import { items } from '../state/items.svelte'
import type { Asset } from '../state/library.svelte'
import { layoutOf } from '../state/model/items'
import { clipFor } from '../state/model/project'
import { project } from '../state/project.svelte'

/**
 * A layout as it sits on an artboard: its arrangement, and for each cell the item it shows (with what's
 * been loaded about it) and how that's framed there. Read inside an effect or derived, it follows
 * the project and the loaded thumbnails.
 */
export interface LayoutScene {
  key: string
  layout: LayoutItem
  arrangement: Arrangement
  cells: Map<string, { asset: Asset | undefined; settings: CropSettings }>
  /** Seconds; 0 when nothing in it moves. */
  duration: number
  /** Changes whenever the picture would: compare to skip redrawing. */
  stamp: string
}

export function layoutScene(key: string, board: Artboard): LayoutScene | null {
  const layout = layoutOf(project.file, key)
  if (!layout) return null
  const arrangement = arrange(layout, board.width, board.height, board.splits?.[key])
  const cells = new Map<string, { asset: Asset | undefined; settings: CropSettings }>()
  for (const c of arrangement.cells)
    cells.set(c.slot.id, { asset: c.slot.item ? items.asset(c.slot.item) : undefined, settings: resolveSettings(board, slotKey(key, c.slot.id)) })
  const lengths = slotsOf(layout.root).flatMap((s) => {
    const a = s.item ? items.asset(s.item) : undefined
    if (a?.kind !== 'video' || !a.duration) return []
    const c = clipFor(project.file, a.name, a.duration)
    return [c.end - c.start]
  })
  const stamp = JSON.stringify([
    layout.radius,
    layout.bgColor,
    arrangement.cells.map((c) => {
      const cell = cells.get(c.slot.id)!
      return [c.rect, cell.settings, cell.asset?.path, cell.asset?.mtime, cell.asset?.w, !!cell.asset?.thumb]
    })
  ])
  return { key, layout, arrangement, cells, duration: layoutDuration(layout.duration, lengths), stamp }
}

/** Each cell's thumbnail, framed: what the grid view and filmstrip draw a layout from. */
export const thumbSource =
  (scene: LayoutScene) =>
  (slot: Slot): CellSource | null => {
    const c = scene.cells.get(slot.id)
    return c?.asset?.thumb ? { src: c.asset.thumb, sw: c.asset.w, sh: c.asset.h, settings: c.settings } : null
  }
