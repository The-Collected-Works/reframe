import type { AssetEntry } from '@shared/types'
import { api, mediaUrl } from '../lib/bridge'
import { posterBlob, thumbnail } from '../lib/media'
import { library, type AssetMeta } from './library.svelte'

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
      .then((meta) => library.setMeta(a, meta))
      .catch(() => library.setMeta(a, { error: true }))
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
