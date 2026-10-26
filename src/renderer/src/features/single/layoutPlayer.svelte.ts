import { untrack } from 'svelte'
import { slotTime } from '@shared/arrangement'
import { mediaUrl } from '../../lib/bridge'
import { releaseVideo, silentVideo } from '../../lib/media'

/** A video cell: where its file is, and the part of it the layout plays. */
export interface LayoutVideo {
  slot: string
  path: string
  start: number
  length: number
  end: 'loop' | 'hold'
}

/**
 * Playing a layout in the single view: one clock for the layout, and a video per video cell that
 * follows it, looping or holding exactly as the export does (see slotTime). Silent, as the export
 * is for now. `frame` changes whenever there's something new to draw. Call `destroy()` when done.
 */
export class LayoutPlayer {
  playing = $state(false)
  /** Seconds into the layout. */
  time = $state(0)
  frame = $state(0)

  private videos = new Map<string, { key: string; v: HTMLVideoElement }>()
  private stop: () => void
  private startedAt = 0
  private startedTime = 0

  constructor(
    private cells: () => LayoutVideo[],
    private duration: () => number
  ) {
    this.stop = $effect.root(() => this.effects())
  }

  destroy(): void {
    this.stop()
    for (const { v } of this.videos.values()) releaseVideo(v)
    this.videos.clear()
  }

  /** What to draw for a cell now: its video once it has a frame, or null (its thumbnail stands in). */
  source(slot: string): HTMLVideoElement | null {
    const v = this.videos.get(slot)?.v
    return v && v.readyState >= 2 ? v : null
  }

  toggle(): void {
    if (this.duration() <= 0) return
    this.playing = !this.playing
  }

  seek(t: number): void {
    const d = this.duration()
    this.time = d > 0 ? Math.min(Math.max(0, t), d) : 0
    if (this.playing) {
      this.startedAt = performance.now()
      this.startedTime = this.time
    }
    this.sync(true)
  }

  private effects() {
    // A video per video cell, kept as long as the cell shows the same file.
    $effect(() => {
      const wanted = this.cells()
      untrack(() => {
        const keep = new Set<string>()
        for (const c of wanted) {
          keep.add(c.slot)
          const have = this.videos.get(c.slot)
          if (have?.key === c.path) continue
          if (have) releaseVideo(have.v)
          const v = silentVideo(mediaUrl(c.path))
          v.loop = false
          v.addEventListener('seeked', () => this.frame++)
          v.addEventListener('loadeddata', () => {
            this.sync(true)
            this.frame++
          })
          this.videos.set(c.slot, { key: c.path, v })
        }
        for (const [slot, { v }] of this.videos) {
          if (keep.has(slot)) continue
          releaseVideo(v)
          this.videos.delete(slot)
        }
        this.sync(true)
      })
    })

    // The clock: while playing, time runs and wraps at the layout's length; each video follows it.
    $effect(() => {
      if (!this.playing) {
        untrack(() => {
          for (const { v } of this.videos.values()) v.pause()
          this.sync(true)
        })
        return
      }
      this.startedAt = performance.now()
      this.startedTime = untrack(() => this.time)
      let raf = 0
      let last = this.startedTime
      const tick = () => {
        const d = this.duration()
        if (d <= 0) return void (this.playing = false)
        const t = (this.startedTime + (performance.now() - this.startedAt) / 1000) % d
        this.time = t
        // Wrapped round: every video starts over together.
        this.sync(t < last)
        last = t
        this.frame++
        raf = requestAnimationFrame(tick)
      }
      // From the next frame: ticking here would make this effect depend on what it sets.
      raf = requestAnimationFrame(tick)
      return () => cancelAnimationFrame(raf)
    })
  }

  /**
   * Each video to where it should be at the current time: played along while the clock runs (and
   * nudged back when it drifts), held on its last frame once a holding one ends, or seeked there
   * when paused or `jump`ing.
   */
  private sync(jump: boolean) {
    for (const c of this.cells()) {
      const v = this.videos.get(c.slot)?.v
      if (!v || v.readyState < 1) continue
      const t = slotTime(this.time, c.start, c.length, c.end)
      const held = c.end === 'hold' && this.time >= c.length
      if (!this.playing || held) {
        if (!v.paused) v.pause()
        if (Math.abs(v.currentTime - t) > 0.02 && !v.seeking) v.currentTime = t
        continue
      }
      if (jump || Math.abs(v.currentTime - t) > 0.25) v.currentTime = t
      if (v.paused) v.play().catch(() => {})
    }
  }
}
