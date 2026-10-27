import { untrack } from 'svelte'
import type { AssetEntry } from '@shared/types'
import { loadStill } from '../../lib/media'

/** The long edge a copy needs to look sharp drawn `need` pixels long: in 512px steps, at most the source's. */
const edgeFor = (long: number, need: number) => Math.min(long, Math.ceil(need / 512) * 512)

/**
 * Downscaled copy of `src` with a long edge of at least `need` pixels (in 512px steps, capped at
 * the source). Built asynchronously and only ever grown, so zooming in sharpens it and zooming out
 * doesn't churn. `bitmap` is null while `floor` (e.g. the thumbnail) already covers what's needed.
 * Create it while a component initialises.
 */
export function bitmapProxy(
  src: () => Blob | null,
  size: () => { w: number; h: number },
  need: () => number,
  floor: () => number
): { readonly bitmap: ImageBitmap | null } {
  let proxy = $state.raw<{ src: Blob; edge: number; bitmap: ImageBitmap } | null>(null)
  const long = $derived(Math.max(size().w, size().h))
  const edge = $derived(edgeFor(long, need()))
  const enough = $derived(edge <= floor())
  const have = $derived(proxy && proxy.src === src() ? proxy : null)
  $effect(() => {
    const blob = src()
    const { w, h } = size()
    const e = edge
    if (!blob || !long || enough || (have && have.edge >= e)) return
    let alive = true
    const s = e / long
    createImageBitmap(blob, {
      resizeWidth: Math.max(1, Math.round(w * s)),
      resizeHeight: Math.max(1, Math.round(h * s)),
      resizeQuality: 'high'
    })
      .then((bitmap) => {
        if (alive) proxy = { src: blob, edge: e, bitmap }
        else bitmap.close()
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  })
  // Draws are synchronous, so once a replacement is in (or the view closes) the old pixels can go
  // now rather than whenever GC gets to them.
  $effect(() => {
    const p = proxy
    return () => p?.bitmap.close()
  })
  return {
    get bitmap() {
      return enough ? null : (have?.bitmap ?? null)
    }
  }
}

/** One picture a set of proxies is asked for: its file, and how big it's drawn (see bitmapProxy). */
export interface ProxyWant {
  key: string
  asset: Pick<AssetEntry, 'path' | 'mtime'> & { kind: string; w: number; h: number }
  need: number
  floor: number
}

/**
 * bitmapProxy for many pictures at once (a composition's cells), by key, each from its file's
 * full-size still (see loadStill). `get` gives null while the thumbnail is enough, or until the
 * copy is made. Create it while a component initialises.
 */
export function bitmapProxies(wants: () => ProxyWant[]): { get(key: string): ImageBitmap | null } {
  type Made = { file: string; edge: number; bitmap: ImageBitmap }
  let made = $state.raw(new Map<string, Made>())
  const loading = new Map<string, { file: string; edge: number }>()
  const fileOf = (w: ProxyWant) => `${w.asset.path}|${w.asset.mtime}`
  const edgeOf = (w: ProxyWant) => edgeFor(Math.max(w.asset.w, w.asset.h), w.need)
  const current = $derived(new Map(wants().map((w) => [w.key, w])))
  let alive = true

  function set(key: string, m: Made | null) {
    const next = new Map(made)
    next.get(key)?.bitmap.close()
    if (m) next.set(key, m)
    else next.delete(key)
    made = next
  }

  $effect(() => {
    const list = [...current.values()]
    untrack(() => {
      for (const key of made.keys()) if (!current.has(key)) set(key, null)
      for (const w of list) {
        const file = fileOf(w)
        const edge = edgeOf(w)
        const have = made.get(w.key)
        const pending = loading.get(w.key)
        if (edge <= w.floor || (have?.file === file && have.edge >= edge) || (pending?.file === file && pending.edge >= edge)) continue
        loading.set(w.key, { file, edge })
        const s = edge / Math.max(w.asset.w, w.asset.h)
        loadStill(w.asset)
          .then((blob) =>
            createImageBitmap(blob, {
              resizeWidth: Math.max(1, Math.round(w.asset.w * s)),
              resizeHeight: Math.max(1, Math.round(w.asset.h * s)),
              resizeQuality: 'high'
            })
          )
          .then((bitmap) => {
            // Still wanted, and bigger than what's there: only ever grown.
            const now = made.get(w.key)
            if (alive && current.get(w.key) && fileOf(current.get(w.key)!) === file && (now?.file !== file || now.edge < edge))
              set(w.key, { file, edge, bitmap })
            else bitmap.close()
          })
          .catch(() => {})
          .finally(() => {
            if (loading.get(w.key)?.edge === edge) loading.delete(w.key)
          })
      }
    })
  })
  // Draws are synchronous, so the pixels can go as soon as the view closes.
  $effect(() => () => {
    alive = false
    for (const m of made.values()) m.bitmap.close()
  })

  return {
    get(key) {
      const w = current.get(key)
      const m = made.get(key)
      return w && m && m.file === fileOf(w) && edgeOf(w) > w.floor ? m.bitmap : null
    }
  }
}
