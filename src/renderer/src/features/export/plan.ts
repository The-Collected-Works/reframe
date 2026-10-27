import { compose, drawComposition, type Composition, type LayerPicture } from '@shared/composition/compose'
import { drawFrame, resolveSettings } from '@shared/framing/framing'
import type { Artboard, Clip, ColorMeta, CropSettings, ExportPrefs, LayerJob, ProjectFile } from '@shared/types'
import { api } from '../../lib/bridge'
import { join } from '../../lib/paths'
import { loadImage, videoInfo } from '../../lib/media'
import type { Asset } from '../../state/library.svelte'
import { compositionOf, type Entry } from '../../state/model/items'
import { folderOf } from '../../state/model/tree'

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
  /**
   * A composition, as it was when the export started (see compose), and its sources' trims then: it's
   * composed again once its videos' details are loaded, so it's timed exactly as it plays.
   */
  composition?: { comp: Composition<Asset>; clips: Record<string, Clip> }
}

export type Status = { state: 'queued' | 'running' | 'done' | 'error'; progress: number; error?: string }

/** What a layer can show: an image or a video that can be read. */
const sourceOf = (a: Asset | undefined): Asset | null => (a && !a.error && a.kind !== 'composition' ? a : null)

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
        const comp = compose(entry.name, item, { board, source: (k) => sourceOf(asset(k)), clip: clipOf })
        const shown = comp.layers.filter((l) => l.source)
        // Nothing in it yet: nothing to write.
        if (!shown.length) continue
        composition = { comp, clips: { ...file.clips } }
        kind = shown.some((l) => l.source!.kind === 'video') ? 'video' : 'image'
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
    const comp = item.composition.comp
    const pictures = await picturesOf(comp, false)
    drawComposition(ctx, comp, 1, (l) => pictures.get(l.id) ?? null)
  } else {
    const img = await loadImage(item.asset.path)
    drawFrame(ctx, img, img.naturalWidth, img.naturalHeight, W, H, item.settings, 1)
  }
  await api.writeFile(item.output, await (await encode(canvas, prefs)).arrayBuffer())
}

/** Each layer's picture at full size; videos are left as holes (`videos`) to show through. */
async function picturesOf(comp: Composition<Asset>, videos: boolean): Promise<Map<string, LayerPicture>> {
  const out = new Map<string, LayerPicture>()
  await Promise.all(
    comp.layers.map(async (l) => {
      const s = l.source
      if (!s) return
      if (s.kind === 'video') {
        if (videos) out.set(l.id, { src: null, sw: 1, sh: 1, settings: l.settings, hole: true })
        return
      }
      const img = await loadImage(s.path)
      out.set(l.id, { src: img, sw: img.naturalWidth, sh: img.naturalHeight, settings: l.settings })
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
  const { comp: planned, clips } = item.composition!
  // Every video's size, length and colour, loaded if they weren't yet; then composed again with them.
  const loaded = new Map<string, Asset & { fps?: number }>()
  for (const l of planned.layers) {
    const s = l.source
    if (s?.kind === 'video' && !loaded.has(s.name)) loaded.set(s.name, { ...s, ...(await videoMeta(s)) })
  }
  const comp = compose(planned.key, planned.item, {
    board: item.board,
    source: (k) => loaded.get(k) ?? planned.layers.find((l) => l.source?.name === k)?.source ?? null,
    clip: (k) => clips[k] ?? { start: 0, end: null }
  })
  const canvas = new OffscreenCanvas(comp.width, comp.height)
  const pictures = await picturesOf(comp, true)
  drawComposition(canvas.getContext('2d')!, comp, 1, (l) => pictures.get(l.id) ?? null)
  const layer = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer())
  const layers: LayerJob[] = []
  let fps = 0
  for (const l of comp.layers) {
    const s = l.source
    if (s?.kind !== 'video' || l.length <= 0) continue
    const m = loaded.get(s.name)!
    fps = Math.max(fps, m.fps ?? 0)
    layers.push({
      input: s.path,
      x: l.rect.x,
      y: l.rect.y,
      width: l.rect.w,
      height: l.rect.h,
      srcWidth: m.w,
      srcHeight: m.h,
      color: m.color,
      settings: l.settings,
      clip: { start: l.start, end: l.start + l.length },
      length: l.length,
      end: l.end
    })
  }
  if (cancelled()) throw new Error('cancelled')
  await api.exportComposition({
    id: item.id,
    output: item.output,
    width: comp.width,
    height: comp.height,
    bgColor: comp.background,
    layer,
    cells: layers,
    duration: comp.duration,
    fps: Math.min(60, Math.round(fps * 1000) / 1000 || 30),
    crf: prefs.videoCrf
  })
}
