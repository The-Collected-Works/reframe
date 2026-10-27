import { drawBento, compositionDuration, arrange, slotKey, slotsOf, type CellSource } from '@shared/composition/bento'
import { drawFrame, resolveSettings } from '@shared/layout'
import type { Artboard, Clip, ColorMeta, CropSettings, ExportPrefs, LayerJob, CompositionItem, ProjectFile } from '@shared/types'
import { api } from '../../lib/bridge'
import { join } from '../../lib/paths'
import { loadImage, videoInfo } from '../../lib/media'
import type { Asset } from '../../state/library.svelte'
import { compositionOf, type Entry } from '../../state/model/items'
import { folderOf } from '../../state/model/tree'

/** A composition's cell as the export found it: what it shows, framed and trimmed as it was then. */
export interface CellPlan {
  slot: string
  asset: Asset
  settings: CropSettings
  clip: Clip
  end: 'loop' | 'hold'
}

export interface Item {
  id: string
  board: Artboard
  asset: Asset
  settings: CropSettings
  /** The trim as it was when the export started. */
  clip: Clip
  output: string
  /** The artboard's folder inside the export folder; it gets the output marker. */
  boardDir: string
  /** What's written: a picture, or a video (a composition with any video in it is one). */
  out: 'image' | 'video'
  /** A composition, as it was when the export started, with its cells. */
  composition?: { key: string; item: CompositionItem; cells: CellPlan[] }
}

export type Status = { state: 'queued' | 'running' | 'done' | 'error'; progress: number; error?: string }

const safe = (s: string) => s.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').trim() || 'Artboard'
const stem = (name: string) => name.replace(/\.[^.]+$/, '')

/**
 * Every file the export will write. Names are compared ignoring case (Windows and macOS do), so
 * "A.jpg" and "a.png" can't both become "a.png" and overwrite each other. A variant is written
 * beside its file under its own name; a composition at the top of the artboard's folder.
 */
export function plan(
  boards: Artboard[],
  entries: Entry[],
  asset: (key: string) => Asset | undefined,
  file: ProjectFile,
  out: string,
  prefs: ExportPrefs
): Item[] {
  const counts = new Map<string, number>()
  boards.forEach((b) => counts.set(safe(b.name).toLowerCase(), (counts.get(safe(b.name).toLowerCase()) ?? 0) + 1))
  const items: Item[] = []
  const clipOf = (key: string): Clip => file.clips[key] ?? { start: 0, end: null }
  for (const board of boards) {
    const folder = counts.get(safe(board.name).toLowerCase())! > 1 ? `${safe(board.name)} ${board.width}x${board.height}` : safe(board.name)
    const used = new Set<string>()
    const boardDir = join(out, folder)
    for (const entry of entries) {
      const a = asset(entry.name)
      const settings = resolveSettings(board, entry.name)
      if (!a || settings.skip || a.error) continue
      let composition: Item['composition']
      let kind: 'image' | 'video' = a.kind === 'video' ? 'video' : 'image'
      if (entry.kind === 'composition') {
        const item = compositionOf(file, entry.name)
        if (!item) continue
        const cells = slotsOf(item.root).flatMap((s): CellPlan[] => {
          const c = s.item ? asset(s.item) : undefined
          if (!c || c.error) return []
          return [{ slot: s.id, asset: c, settings: resolveSettings(board, slotKey(entry.name, s.id)), clip: clipOf(c.name), end: s.end ?? 'loop' }]
        })
        // Nothing in it yet: nothing to write.
        if (!cells.length) continue
        composition = { key: entry.name, item, cells }
        kind = cells.some((c) => c.asset.kind === 'video') ? 'video' : 'image'
      }
      const ext = kind === 'video' ? 'mp4' : prefs.imageFormat
      // Subfolders are mirrored under the artboard's folder ("Square/Shoot A/clip.mp4"); a variant
      // goes beside its file, under its own name.
      const dir = folderOf(entry.source ?? entry.name)
      const base = entry.kind === 'composition' ? safe(entry.label) : entry.source ? `${dir ? dir + '/' : ''}${safe(entry.label)}` : stem(entry.name)
      let name = `${base}.${ext}`
      if (used.has(name.toLowerCase()) && !entry.source && entry.kind !== 'composition') name = `${entry.name.replace(/\./g, '_')}.${ext}`
      for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base} ${n}.${ext}`
      used.add(name.toLowerCase())
      items.push({
        id: `${board.id}/${entry.name}`,
        board,
        asset: a,
        settings,
        clip: clipOf(entry.name),
        output: join(boardDir, ...name.split('/')),
        boardDir,
        out: kind,
        composition
      })
    }
  }
  return items
}

const encode = (canvas: OffscreenCanvas, prefs: ExportPrefs) =>
  canvas.convertToBlob({ type: prefs.imageFormat === 'jpg' ? 'image/jpeg' : `image/${prefs.imageFormat}`, quality: prefs.imageQuality })

export async function renderImage(item: Item, prefs: ExportPrefs): Promise<void> {
  const { width: W, height: H } = item.board
  const canvas = new OffscreenCanvas(W, H)
  const ctx = canvas.getContext('2d')!
  if (item.composition) {
    const sources = await compositionSources(item, false)
    drawBento(ctx, item.composition.item, arrangementOf(item), W, H, 1, (s) => sources.get(s.id) ?? null)
  } else {
    const img = await loadImage(item.asset.path)
    drawFrame(ctx, img, img.naturalWidth, img.naturalHeight, W, H, item.settings, 1)
  }
  await api.writeFile(item.output, await (await encode(canvas, prefs)).arrayBuffer())
}

const arrangementOf = (item: Item) => arrange(item.composition!.item, item.board.width, item.board.height, item.board.splits?.[item.composition!.key])

/** Each cell's picture at full size; videos are left as holes (`videos`) to show through. */
async function compositionSources(item: Item, videos: boolean): Promise<Map<string, CellSource>> {
  const out = new Map<string, CellSource>()
  await Promise.all(
    item.composition!.cells.map(async (c) => {
      if (c.asset.kind === 'video') {
        if (videos) out.set(c.slot, { src: null, sw: 1, sh: 1, settings: c.settings, hole: true })
        return
      }
      const img = await loadImage(c.asset.path)
      out.set(c.slot, { src: img, sw: img.naturalWidth, sh: img.naturalHeight, settings: c.settings })
    })
  )
  return out
}

/** A video's size, length and colour, as loaded or (not loaded yet) read now. */
async function videoMeta(a: Asset): Promise<{ w: number; h: number; duration: number; color?: ColorMeta; fps?: number }> {
  return a.w && a.color ? a : { ...(await videoInfo(a.path)), fps: a.fps }
}

export async function renderVideo(item: Item, prefs: ExportPrefs, cancelled: () => boolean): Promise<void> {
  if (item.composition) return renderCompositionVideo(item, prefs, cancelled)
  const { w, h, duration, color } = await videoMeta(item.asset)
  // Cancelled while that was loading: don't start.
  if (cancelled()) throw new Error('cancelled')
  await api.exportVideo({
    id: item.id,
    input: item.asset.path,
    output: item.output,
    width: item.board.width,
    height: item.board.height,
    srcWidth: w,
    srcHeight: h,
    color,
    settings: item.settings,
    clip: item.clip,
    duration,
    crf: prefs.videoCrf
  })
}

/**
 * A composition with video in it: the renderer draws everything that doesn't move into one layer (the
 * background, the images, the gaps and rounded corners, with holes for the videos), and ffmpeg
 * lays each video under its hole.
 */
async function renderCompositionVideo(item: Item, prefs: ExportPrefs, cancelled: () => boolean): Promise<void> {
  const composition = item.composition!
  const { width: W, height: H } = item.board
  const arrangement = arrangementOf(item)
  const canvas = new OffscreenCanvas(W, H)
  const sources = await compositionSources(item, true)
  drawBento(canvas.getContext('2d')!, composition.item, arrangement, W, H, 1, (s) => sources.get(s.id) ?? null)
  const layer = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer())
  const cells: LayerJob[] = []
  let fps = 0
  for (const c of composition.cells) {
    if (c.asset.kind !== 'video') continue
    const rect = arrangement.cells.find((l) => l.slot.id === c.slot)!.rect
    const m = await videoMeta(c.asset)
    const end = c.clip.end ?? m.duration
    fps = Math.max(fps, m.fps ?? 0)
    cells.push({
      input: c.asset.path,
      x: rect.x,
      y: rect.y,
      width: rect.w,
      height: rect.h,
      srcWidth: m.w,
      srcHeight: m.h,
      color: m.color,
      settings: c.settings,
      clip: c.clip,
      length: Math.max(0.05, end - c.clip.start),
      end: c.end
    })
  }
  if (cancelled()) throw new Error('cancelled')
  await api.exportComposition({
    id: item.id,
    output: item.output,
    width: W,
    height: H,
    bgColor: composition.item.bgColor,
    layer,
    cells,
    duration: compositionDuration(
      composition.item.duration,
      cells.map((c) => c.length)
    ),
    fps: Math.min(60, Math.round(fps * 1000) / 1000 || 30),
    crf: prefs.videoCrf
  })
}
