import type { AssetEntry, ColorMeta } from '@shared/types'
import { api, mediaUrl } from '../lib/bridge'
import { app, type AssetMeta } from './app.svelte'

/**
 * Loading what the app shows of each asset: thumbnails and details for the grid (queued, what's on
 * screen first), full-size stills for the single view, and images for export.
 */

/** Long edge of grid thumbnails: enough for the largest cell size at this display density. */
const THUMB = Math.round(Math.min(960, 480 * (window.devicePixelRatio || 1)))

/** Natural size of an encoded image (rotation from EXIF applied), read without decoding its pixels. */
function measure(blob: Blob): Promise<{ w: number; h: number }> {
  const url = URL.createObjectURL(blob)
  const img = new Image()
  return new Promise<{ w: number; h: number }>((resolve, reject) => {
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight })
    img.onerror = () => reject(new Error('Could not read image'))
    img.src = url
  }).finally(() => URL.revokeObjectURL(url))
}

/**
 * Grid thumbnail straight from the encoded file. Decoding and downscaling in one step from a Blob
 * happens on a background thread; shrinking an already-decoded full-size image would happen on the
 * main thread and stall scrolling for tens of milliseconds per photo or 4K poster.
 */
async function thumbnail(blob: Blob): Promise<{ w: number; h: number; thumb: ImageBitmap }> {
  const { w, h } = await measure(blob)
  const k = Math.min(1, THUMB / Math.max(w, h))
  const thumb = await createImageBitmap(blob, {
    resizeWidth: Math.max(1, Math.round(w * k)),
    resizeHeight: Math.max(1, Math.round(h * k)),
    resizeQuality: 'high',
    imageOrientation: 'from-image'
  })
  return { w, h, thumb }
}

export function loadImage(path: string): Promise<HTMLImageElement> {
  const img = new Image()
  img.crossOrigin = 'anonymous'
  img.decoding = 'async'
  img.src = mediaUrl(path)
  return img.decode().then(() => img)
}

/** A video's size, timing and colour metadata (for exporting one that hasn't loaded yet). */
export async function videoInfo(path: string): Promise<{ w: number; h: number; duration: number; color: ColorMeta }> {
  const res = await api.poster(path)
  const { w, h } = await measure(posterBlob(res.data))
  return { w, h, duration: res.duration, color: res.color }
}

async function loadMeta(a: AssetEntry): Promise<Partial<AssetMeta>> {
  if (a.kind === 'image') return { ...(await thumbnail(await (await fetch(mediaUrl(a.path))).blob())), error: false }
  const res = await api.poster(a.path)
  const { w, h, thumb } = await thumbnail(posterBlob(res.data))
  return { w, h, thumb, duration: res.duration, color: res.color, audio: res.audio, fps: res.fps, error: false }
}

/**
 * Loading what the grid needs for each asset, four at a time, with what's on screen first. Results
 * land only on the asset they were loaded for (the store checks the file is still the same one), and
 * opening another folder drops whatever was still queued from the last.
 */
const pending: AssetEntry[] = []
const queued = new Set<string>()
let active = 0
const keyOf = (a: AssetEntry) => a.path + '|' + a.mtime

function pump() {
  while (active < 4 && pending.length) {
    const a = pending.shift()!
    active++
    loadMeta(a)
      .then((meta) => app.setMeta(a, meta))
      .catch(() => app.setMeta(a, { error: true }))
      .finally(() => {
        active--
        queued.delete(keyOf(a))
        pump()
      })
  }
}

/** Moves an asset to the front of the loading queue (it just scrolled into view). */
export function prioritize(path: string): void {
  const i = pending.findIndex((a) => a.path === path)
  if (i > 0) pending.unshift(...pending.splice(i, 1))
}

/** Queues loading for these assets. `fresh` (a new folder) drops anything still queued first. */
export function hydrate(entries: AssetEntry[], fresh: boolean): void {
  if (fresh) {
    for (const a of pending) queued.delete(keyOf(a))
    pending.length = 0
  }
  for (const a of entries) {
    if (queued.has(keyOf(a))) continue
    queued.add(keyOf(a))
    pending.push(a)
  }
  pump()
}

/** A video's poster as an encoded JPEG. */
const posterBlob = (data: Uint8Array) => new Blob([data as BlobPart], { type: 'image/jpeg' })

/**
 * Full-resolution still for the single view as encoded bytes: the image file itself, or a video's
 * poster JPEG. Kept encoded so decoding (and downscaling) happens off the main thread in
 * createImageBitmap, which also applies EXIF orientation the same way <img> does.
 */
const stills = new Map<string, Promise<Blob>>()
export function loadStill(a: AssetEntry): Promise<Blob> {
  const key = a.path + a.mtime
  let p = stills.get(key)
  if (!p) {
    p = a.kind === 'image' ? fetch(mediaUrl(a.path)).then((r) => r.blob()) : api.poster(a.path).then((r) => posterBlob(r.data))
    p.catch(() => stills.delete(key))
    stills.set(key, p)
    if (stills.size > 6) stills.delete(stills.keys().next().value!)
  }
  return p
}
