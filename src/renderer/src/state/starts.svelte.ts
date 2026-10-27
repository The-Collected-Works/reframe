import { SvelteMap } from 'svelte/reactivity'
import type { ColorMeta } from '@shared/types'
import { api } from '../lib/bridge'
import { THUMB } from '../lib/media'
import { copies } from './playback.svelte'

/** A trimmed video: the file, and where its trim starts. */
export interface Start {
  path: string
  mtime: number
  w: number
  h: number
  duration: number
  color?: ColorMeta
  at: number
}

const keyOf = (s: Pick<Start, 'path' | 'mtime' | 'at'>) => `${s.path}|${s.mtime}|${s.at.toFixed(3)}`

/**
 * Thumbnails for videos trimmed to start after their first frame: the frame playback starts on, so
 * the grid, the filmstrip and compositions show what plays (and the single view doesn't jump from one to
 * the other). Read from the video's playback copy where there is one (every frame a keyframe, so
 * it's quick), else the file; two at a time. Only those still trimmed that way are kept.
 */
class Starts {
  private frames = new SvelteMap<string, ImageBitmap>()
  private loading = new Set<string>()
  private queue: Start[] = []
  private active = 0

  /** The start frame for a trimmed video, once loaded. */
  get(s: Pick<Start, 'path' | 'mtime' | 'at'>): ImageBitmap | undefined {
    return this.frames.get(keyOf(s))
  }

  /** Every trimmed video's start, as things are now: missing ones load, ones no longer needed go. */
  want(list: Start[]): void {
    const keep = new Set(list.map(keyOf))
    for (const [k, b] of this.frames) {
      if (keep.has(k)) continue
      b.close()
      this.frames.delete(k)
    }
    this.queue = list.filter((s) => !this.frames.has(keyOf(s)) && !this.loading.has(keyOf(s)))
    this.pump()
  }

  private pump() {
    while (this.active < 2 && this.queue.length) {
      const s = this.queue.shift()!
      const key = keyOf(s)
      this.loading.add(key)
      this.active++
      // A copy's frames are already BT.709, as export converts; the file needs its own colour.
      const copy = copies.smallest(s)
      api
        .frame(copy ?? s.path, s.at, copy ? undefined : s.color, `start:${key}`, THUMB)
        .then((jpeg) => (jpeg ? createImageBitmap(new Blob([jpeg as BlobPart], { type: 'image/jpeg' })) : null))
        .then((b) => b && this.frames.set(key, b))
        .catch(() => {})
        .finally(() => {
          this.loading.delete(key)
          this.active--
          this.pump()
        })
    }
  }
}

export const starts = new Starts()
