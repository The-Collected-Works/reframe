import { reconcileWeights, type Born } from '@shared/composition/bento'
import { compose, type Composition, type Layer, type LayerPicture } from '@shared/composition/compose'
import { computePlacement } from '@shared/framing/framing'
import type { Artboard, BentoNode, CompositionItem } from '@shared/types'
import type { Track } from '../lib/playback/playback'
import { items } from './items.svelte'
import type { Asset } from './library.svelte'
import { compositionOf } from './model/items'
import { project } from './project.svelte'

/** A composition as the app shows it: its layers' sources are assets, with what's been loaded about them. */
export type Composed = Composition<Asset> & {
  /** Changes whenever the picture would: compare to skip redrawing. */
  stamp: string
}

/**
 * The composition `key` on `board`, from the project and what's loaded about its items (see
 * compose). Read inside an effect or derived, it follows them.
 */
export function composed(key: string, board: Artboard): Composed | null {
  const item = compositionOf(project.file, key)
  return item ? build(key, item, board) : null
}

/**
 * The composition `key` on `board` as it would be with its tree `root` instead (to show a change
 * before it's made): this artboard's sizes carried over as the change would carry them.
 */
export function composedWith(key: string, board: Artboard, root: BentoNode, born?: Born): Composed | null {
  const item = compositionOf(project.file, key)
  if (!item) return null
  const splits = reconcileWeights(item.root, root, board.splits?.[key], born)
  return build(key, { ...item, root }, { ...board, splits: { ...board.splits, ...(splits ? { [key]: splits } : {}) } })
}

function build(key: string, item: CompositionItem, board: Artboard): Composed {
  const c = compose(key, item, {
    board,
    source: (k) => {
      const a = items.asset(k)
      return a && a.kind !== 'composition' ? a : null
    },
    clip: (k) => project.file.clips[k] ?? { start: 0, end: null }
  })
  const stamp = JSON.stringify([
    c.background,
    c.layers.map((l) => [l.rect, l.radius, l.settings, l.source?.path, l.source?.mtime, l.source?.w, !!l.source?.thumb, l.source?.thumbAt])
  ])
  return { ...c, stamp }
}

/** A layer's thumbnail, framed: what the grid and the filmstrip draw a composition from. */
export function thumbnail(layer: Layer<Asset>): LayerPicture | null {
  const s = layer.source
  return s?.thumb ? { src: s.thumb, sw: s.w, sh: s.h, settings: layer.settings } : null
}

/** Device pixels, rounded so small zooms don't keep asking for another copy size. */
export const quantize = (px: number): number => Math.ceil(px / 128) * 128

/**
 * A composition's videos as playback tracks, each the stretch its layer plays, sized to its picture
 * on screen (`scale`: device pixels per artboard pixel).
 */
export function tracksOf(c: Composition<Asset>, scale: number): Track[] {
  return c.layers.flatMap((l) => {
    const s = l.source
    if (s?.kind !== 'video' || !s.w || l.length <= 0) return []
    const p = computePlacement(l.rect.w, l.rect.h, s.w, s.h, l.settings)
    return [{ id: l.id, file: s, start: l.start, length: l.length, end: l.end, need: quantize(Math.max(p.w, p.h) * scale) }]
  })
}
