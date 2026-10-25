import { drawFrame, resolveSettings } from '@shared/layout'
import type { Artboard, AssetEntry, Clip, CropSettings, ExportPrefs } from '@shared/types'
import { api, loadImage, videoInfo } from '../media'
import { join } from '../paths'
import { withMeta, type Asset, type AssetMeta } from '../store.svelte'

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
}

export type Status = { state: 'queued' | 'running' | 'done' | 'error'; progress: number; error?: string }

const safe = (s: string) => s.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').trim() || 'Artboard'
const stem = (name: string) => name.replace(/\.[^.]+$/, '')

/**
 * Every file the export will write. Names are compared ignoring case (Windows and macOS do), so
 * "A.jpg" and "a.png" can't both become "a.png" and overwrite each other.
 */
export function plan(
  boards: Artboard[],
  entries: AssetEntry[],
  meta: { get(name: string): AssetMeta | undefined },
  clips: Record<string, Clip>,
  out: string,
  prefs: ExportPrefs
): Item[] {
  const counts = new Map<string, number>()
  boards.forEach((b) => counts.set(safe(b.name).toLowerCase(), (counts.get(safe(b.name).toLowerCase()) ?? 0) + 1))
  const items: Item[] = []
  for (const board of boards) {
    const folder = counts.get(safe(board.name).toLowerCase())! > 1 ? `${safe(board.name)} ${board.width}x${board.height}` : safe(board.name)
    const used = new Set<string>()
    for (const entry of entries) {
      const asset = withMeta(entry, meta.get(entry.name))
      const settings = resolveSettings(board, asset.name)
      if (settings.skip || asset.error) continue
      const ext = asset.kind === 'video' ? 'mp4' : prefs.imageFormat
      // Subfolders are mirrored under the artboard's folder ("Square/Shoot A/clip.mp4").
      let file = `${stem(asset.name)}.${ext}`
      if (used.has(file.toLowerCase())) file = `${asset.name.replace(/\./g, '_')}.${ext}`
      used.add(file.toLowerCase())
      const boardDir = join(out, folder)
      const clip = clips[asset.name] ?? { start: 0, end: null }
      items.push({ id: `${board.id}/${asset.name}`, board, asset, settings, clip, output: join(boardDir, ...file.split('/')), boardDir })
    }
  }
  return items
}

export async function renderImage(item: Item, prefs: ExportPrefs): Promise<void> {
  const img = await loadImage(item.asset.path)
  const { width: W, height: H } = item.board
  const canvas = new OffscreenCanvas(W, H)
  const ctx = canvas.getContext('2d')!
  drawFrame(ctx, img, img.naturalWidth, img.naturalHeight, W, H, item.settings, 1)
  const type = prefs.imageFormat === 'jpg' ? 'image/jpeg' : `image/${prefs.imageFormat}`
  const blob = await canvas.convertToBlob({ type, quality: prefs.imageQuality })
  await api.writeFile(item.output, await blob.arrayBuffer())
}

export async function renderVideo(item: Item, prefs: ExportPrefs, cancelled: () => boolean): Promise<void> {
  let { w, h, duration, color } = item.asset
  if (!w || !color) ({ w, h, duration, color } = await videoInfo(item.asset.path))
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
