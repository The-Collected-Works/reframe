import type { ColorMeta } from '@shared/types'
import { useStore, type Asset } from './store'

export const api = window.reframe

export const mediaUrl = (path: string): string => 'media://f/' + encodeURIComponent(path)

/** Long edge of grid thumbnails: enough for the largest cell size at this display density. */
const THUMB = Math.round(Math.min(960, 480 * (window.devicePixelRatio || 1)))

async function shrink(src: ImageBitmap | HTMLImageElement, w: number, h: number): Promise<ImageBitmap> {
  const k = Math.min(1, THUMB / Math.max(w, h))
  return createImageBitmap(src, {
    resizeWidth: Math.max(1, Math.round(w * k)),
    resizeHeight: Math.max(1, Math.round(h * k)),
    resizeQuality: 'high'
  })
}

export function loadImage(path: string): Promise<HTMLImageElement> {
  const img = new Image()
  img.crossOrigin = 'anonymous'
  img.decoding = 'async'
  img.src = mediaUrl(path)
  return img.decode().then(() => img)
}

export async function loadPoster(path: string): Promise<{ bitmap: ImageBitmap; duration: number; color: ColorMeta }> {
  const res = await api.poster(path)
  const bitmap = await createImageBitmap(new Blob([res.data as BlobPart], { type: 'image/jpeg' }))
  return { bitmap, duration: res.duration, color: res.color }
}

async function loadMeta(a: Asset): Promise<Partial<Asset>> {
  if (a.kind === 'image') {
    const img = await loadImage(a.path)
    return { w: img.naturalWidth, h: img.naturalHeight, thumb: await shrink(img, img.naturalWidth, img.naturalHeight) }
  }
  const { bitmap, duration, color } = await loadPoster(a.path)
  const thumb = await shrink(bitmap, bitmap.width, bitmap.height)
  const meta = { w: bitmap.width, h: bitmap.height, duration, color, thumb }
  bitmap.close()
  return meta
}

const queued = new Set<string>()
const pending: Asset[] = []
let active = 0

function pump() {
  while (active < 4 && pending.length) {
    const a = pending.shift()!
    active++
    loadMeta(a)
      .then((meta) => useStore.getState().patchAsset(a.name, meta))
      .catch(() => useStore.getState().patchAsset(a.name, { error: true }))
      .finally(() => {
        active--
        queued.delete(a.path + a.mtime)
        pump()
      })
  }
}

/** Moves an asset to the front of the loading queue (it just scrolled into view). */
export function prioritize(path: string): void {
  const i = pending.findIndex((a) => a.path === path)
  if (i > 0) pending.unshift(...pending.splice(i, 1))
}

/** Queue metadata + thumbnail loading for any assets that don't have it yet. */
export function hydrate(assets: Asset[]): void {
  for (const a of assets) {
    const key = a.path + a.mtime
    if (a.thumb || a.error || queued.has(key)) continue
    queued.add(key)
    pending.push(a)
  }
  pump()
}

/**
 * Full-resolution still for the single view as encoded bytes: the image file itself, or a video's
 * poster JPEG. Kept encoded so decoding (and downscaling) happens off the main thread in
 * createImageBitmap, which also applies EXIF orientation the same way <img> does.
 */
const stills = new Map<string, Promise<Blob>>()
export function loadStill(a: Asset): Promise<Blob> {
  const key = a.path + a.mtime
  let p = stills.get(key)
  if (!p) {
    p =
      a.kind === 'image'
        ? fetch(mediaUrl(a.path)).then((r) => r.blob())
        : api.poster(a.path).then((r) => new Blob([r.data as BlobPart], { type: 'image/jpeg' }))
    p.catch(() => stills.delete(key))
    stills.set(key, p)
    if (stills.size > 6) stills.delete(stills.keys().next().value!)
  }
  return p
}

type EyeDropperCtor = new () => { open(options?: { signal?: AbortSignal }): Promise<{ sRGBHex: string }> }

let pickAbort: AbortController | null = null

export function cancelPick(): void {
  pickAbort?.abort()
}

/**
 * Native eyedropper for the background colour. Grid thumbnails and the paused single-view frame
 * are decoded exactly as export decodes them, so screen pixels there are the real colours. While
 * it's open, `picking` pauses playback and hover previews, whose browser decode can be off.
 */
export async function pickBackground(): Promise<void> {
  const EyeDropper = (window as unknown as { EyeDropper?: EyeDropperCtor }).EyeDropper
  const st = useStore.getState()
  if (!EyeDropper || st.picking) return
  st.setPicking(true)
  pickAbort = new AbortController()
  try {
    const { sRGBHex } = await new EyeDropper().open({ signal: pickAbort.signal })
    if (/^#[0-9a-f]{6}$/i.test(sRGBHex)) useStore.getState().edit({ bg: 'color', bgColor: sRGBHex.toLowerCase() })
  } catch {
    // Cancelled.
  } finally {
    pickAbort = null
    useStore.getState().setPicking(false)
  }
}
