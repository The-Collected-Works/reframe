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
  const edge = $derived(Math.min(long, Math.ceil(need() / 512) * 512))
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
      return enough ? null : have?.bitmap ?? null
    }
  }
}
