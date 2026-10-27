import { drawFrame, resolveSettings, type Rect } from '../layout'
import type { Artboard, CompositionItem, CropSettings } from '../types'
import { arrange, slotKey, type Arrangement } from './bento'

/**
 * Compositions: several items put together on one artboard, as layers. `compose` turns a
 * composition item into what everything else works from: its size, background and duration, and
 * each layer's source, place, framing and timing. The grid's thumbnails, the editor, playback and
 * export all read the same result, so what's previewed is what's exported. Each type of composition
 * (see CompositionItem) has its own way of placing layers; so far, bento (see bento.ts).
 */

/** What a layer can show: an image or a video, and what's known about it. */
export interface LayerSource {
  /** Its key (a file's name or a variant's), for its trim. */
  name: string
  kind: string
  w: number
  h: number
  /** Seconds (0 for an image, or a video not loaded yet). */
  duration: number
}

/** When a layer is shorter than its composition: it plays again from its start, or holds its last frame. */
export type LayerEnd = 'loop' | 'hold'

export interface Layer<S extends LayerSource = LayerSource> {
  /** Stable within its composition (a bento cell's slot). */
  id: string
  /** What it shows; null for an empty cell (or one whose item is gone). */
  source: S | null
  /** Where it sits, in whole artboard pixels, and how round its corners are. */
  rect: Rect
  radius: number
  /** How its source is framed in `rect`. */
  settings: CropSettings
  /** The stretch of a video it plays (seconds, after its trim); 0 long for a still. */
  start: number
  length: number
  end: LayerEnd
}

export interface Composition<S extends LayerSource = LayerSource> {
  key: string
  item: CompositionItem
  width: number
  height: number
  background: string
  /** Seconds; 0 when nothing in it moves. */
  duration: number
  /** Bottom to top. */
  layers: Layer<S>[]
  /** A bento's cells, splits and the gaps between them (what its editor works with). */
  arrangement: Arrangement
}

/** What composing needs to know about the project. */
export interface ComposeContext<S extends LayerSource> {
  board: Artboard
  /** The image or video an item key shows (null if it's gone, or isn't one). */
  source(key: string): S | null
  /** A source's trim (an `end` of null: to the end). */
  clip(key: string): { start: number; end: number | null }
}

/** `item` (keyed `key`) on `ctx.board`. */
export function compose<S extends LayerSource>(key: string, item: CompositionItem, ctx: ComposeContext<S>): Composition<S> {
  const { board } = ctx
  const arrangement = arrange(item, board.width, board.height, board.splits?.[key])
  const layers = arrangement.cells.map(({ slot, rect }): Layer<S> => {
    const source = slot.item ? ctx.source(slot.item) : null
    return {
      id: slot.id,
      source,
      rect,
      radius: item.radius,
      settings: resolveSettings(board, slotKey(key, slot.id)),
      ...timing(source, ctx),
      end: slot.end ?? 'loop'
    }
  })
  return {
    key,
    item,
    width: board.width,
    height: board.height,
    background: item.bgColor,
    duration: compositionDuration(
      item.duration,
      layers.filter((l) => l.length > 0).map((l) => l.length)
    ),
    layers,
    arrangement
  }
}

/** A video plays its trim (at least a few frames of it); anything else is a still. */
function timing(source: LayerSource | null, ctx: ComposeContext<LayerSource>): { start: number; length: number } {
  if (source?.kind !== 'video' || !(source.duration > 0)) return { start: 0, length: 0 }
  const clip = ctx.clip(source.name)
  const end = Math.min(source.duration, clip.end ?? source.duration)
  return { start: clip.start, length: Math.max(0.05, end - clip.start) }
}

/** How long a composition runs: its set duration, or its longest video. 0: no video, so it's a still. */
export function compositionDuration(duration: number | null, lengths: number[]): number {
  if (!lengths.length) return 0
  return Math.max(0.1, duration ?? Math.max(...lengths))
}

/**
 * Where a layer is in its source when the composition is at `t` seconds: looping round its stretch,
 * or holding its last frame once it's played through.
 */
export function layerTime(t: number, layer: { start: number; length: number; end: LayerEnd }): number {
  if (layer.length <= 0) return layer.start
  return layer.start + (layer.end === 'hold' ? Math.min(t, Math.max(0, layer.length - 1 / 60)) : t % layer.length)
}

// ---- drawing

/** What a layer shows when drawn: a picture framed by `settings`, or (`hole`) nothing, cut out. */
export interface LayerPicture {
  src: CanvasImageSource | null
  sw: number
  sh: number
  settings: CropSettings
  hole?: boolean
}

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

/** A layer's outline (its rectangle, rounded), as the current path. */
export function layerPath(ctx: Ctx, r: Rect, radius: number, k: number): void {
  ctx.beginPath()
  ctx.roundRect(r.x * k, r.y * k, r.w * k, r.h * k, Math.max(0, Math.min(radius, r.w / 2, r.h / 2)) * k)
}

/**
 * Draws a composition: its background, then each layer framed into its (rounded) rectangle. `k` maps
 * artboard pixels to canvas pixels, as for drawFrame. A layer with nothing to show is left as
 * background, or filled with `empty` (the editor's placeholder).
 */
export function drawComposition<S extends LayerSource>(
  ctx: Ctx,
  c: Pick<Composition<S>, 'width' | 'height' | 'background' | 'layers'>,
  k: number,
  picture: (layer: Layer<S>) => LayerPicture | null,
  empty?: string
): void {
  ctx.save()
  ctx.fillStyle = c.background
  ctx.fillRect(0, 0, c.width * k, c.height * k)
  for (const layer of c.layers) {
    const p = picture(layer)
    const { rect } = layer
    layerPath(ctx, rect, layer.radius, k)
    if (p?.hole) {
      ctx.save()
      ctx.globalCompositeOperation = 'destination-out'
      ctx.fill()
      ctx.restore()
    } else if (p && p.sw) {
      ctx.save()
      ctx.clip()
      ctx.translate(rect.x * k, rect.y * k)
      drawFrame(ctx, p.src, p.sw, p.sh, rect.w, rect.h, p.settings, k)
      ctx.restore()
    } else if (empty) {
      ctx.fillStyle = empty
      ctx.fill()
    }
  }
  ctx.restore()
}
