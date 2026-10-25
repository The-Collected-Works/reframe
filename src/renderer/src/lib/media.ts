import type { AssetEntry, ColorMeta } from '@shared/types'
import { api, mediaUrl } from './bridge'

/**
 * Reading media files as the renderer shows them: thumbnails, full-size stills, posters and export
 * sources. Plain I/O; nothing here touches app state.
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
export async function thumbnail(blob: Blob): Promise<{ w: number; h: number; thumb: ImageBitmap }> {
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

/** A video's poster as an encoded JPEG. */
export const posterBlob = (data: Uint8Array) => new Blob([data as BlobPart], { type: 'image/jpeg' })

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

/** A muted video element for drawing from (never shown or heard): previews, scrubbing, trim frames. */
export function silentVideo(src: string): HTMLVideoElement {
  const v = document.createElement('video')
  v.crossOrigin = 'anonymous'
  v.muted = true
  v.playsInline = true
  v.preload = 'auto'
  v.src = src
  return v
}

/** Stops a video and lets go of its file and decoder (dropping the element alone can hold them a while). */
export function releaseVideo(v: HTMLVideoElement): void {
  v.pause()
  v.removeAttribute('src')
  v.load()
}
