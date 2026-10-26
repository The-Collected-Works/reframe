import { SvelteMap } from 'svelte/reactivity'
import type { ColorMeta } from '@shared/types'
import { api, mediaUrl } from '../bridge'

/** A video file as playback knows it. */
export interface MediaFile {
  path: string
  mtime: number
  w: number
  h: number
  color?: ColorMeta
}

/** Long edges (pixels) copies are made at, each capped at the file's own. */
const SIZES = [960, 1920]
/** A copy this much smaller than what's on screen still looks sharp (and saves making a bigger one). */
const SLACK = 0.85

/** The copy sizes a file can have, smallest first. */
export const sizesOf = (f: MediaFile): number[] => [...new Set(SIZES.map((s) => Math.min(s, Math.max(f.w, f.h))))]

/** The size to show `f` at when it covers `need` device pixels: the smallest that's sharp enough. */
export function sizeFor(f: MediaFile, need: number): number {
  const sizes = sizesOf(f)
  return sizes.find((s) => s >= need * SLACK) ?? sizes[sizes.length - 1]
}

const fileKey = (f: MediaFile) => `${f.path}|${f.mtime}`
const copyKey = (f: MediaFile, size: number) => `${fileKey(f)}|${size}`

/**
 * The playback copies of video files: small, every frame a keyframe, so they play several at once
 * and seek instantly where originals (4K, 60fps, keyframes seconds apart) can't. Made by the media
 * worker one at a time, in the order this decides: what's wanted on screen now, smallest first
 * (quick to make, so something good shows soon), in the order it was asked for. Nothing is made
 * for what's no longer wanted. Kept for the session; the app clears them when it quits.
 */
class Copies {
  /** By file and size: the copy's path, or null (none could be made). */
  private made = new SvelteMap<string, string | null>()
  /** What's wanted, by file and size, with how many ask for it and since when. */
  private wanted = new Map<string, { file: MediaFile; size: number; refs: number; since: number }>()
  private making = false
  private asked = 0

  /**
   * Asks for `file` at `size` (and at the smallest size first, if that's bigger): made in the
   * background unless already there. Returns a function that withdraws the request. Call it from an
   * effect, so it's withdrawn when whatever asked goes away.
   */
  want(file: MediaFile, size: number): () => void {
    const sizes = [...new Set([sizesOf(file)[0], size])]
    for (const s of sizes) {
      const key = copyKey(file, s)
      const w = this.wanted.get(key)
      if (w) w.refs++
      else this.wanted.set(key, { file, size: s, refs: 1, since: ++this.asked })
    }
    this.next()
    return () => {
      for (const s of sizes) {
        const w = this.wanted.get(copyKey(file, s))
        if (w && --w.refs <= 0) this.wanted.delete(copyKey(file, s))
      }
    }
  }

  /**
   * The best copy there is to show `file` at `size`: that size, or the closest made (bigger before
   * smaller). Null while there's none yet.
   */
  best(file: MediaFile, size: number): { url: string; size: number } | null {
    const sizes = sizesOf(file)
    const order = [...sizes.filter((s) => s >= size), ...sizes.filter((s) => s < size).reverse()]
    for (const s of order) {
      const path = this.made.get(copyKey(file, s))
      if (path) return { url: mediaUrl(path), size: s }
    }
    return null
  }

  /** None could be made at any size (the original has to stand in). */
  failed(file: MediaFile): boolean {
    return sizesOf(file).every((s) => this.made.get(copyKey(file, s)) === null)
  }

  /** Whether `file` has nothing to show from yet (and one is on its way). */
  pending(file: MediaFile): boolean {
    return !this.best(file, 0) && !this.failed(file)
  }

  private async next() {
    if (this.making) return
    this.making = true
    for (;;) {
      const todo = [...this.wanted.entries()].filter(([k]) => !this.made.has(k)).sort(([, a], [, b]) => a.size - b.size || a.since - b.since)
      if (!todo.length) break
      const [key, { file, size }] = todo[0]
      try {
        this.made.set(key, await api.copy(file.path, file.w, file.h, file.color, size))
      } catch {
        this.made.set(key, null)
      }
    }
    this.making = false
  }
}

export const copies = new Copies()
