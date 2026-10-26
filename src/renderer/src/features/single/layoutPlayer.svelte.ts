import { untrack } from 'svelte'
import { SvelteMap } from 'svelte/reactivity'
import { slotTime } from '@shared/arrangement'
import type { ColorMeta } from '@shared/types'
import { api, mediaUrl } from '../../lib/bridge'
import { releaseVideo, silentVideo } from '../../lib/media'

/** A video cell: its file (and what's known about it), and the part of it the layout plays. */
export interface LayoutVideo {
  slot: string
  path: string
  mtime: number
  w: number
  h: number
  color?: ColorMeta
  start: number
  length: number
  end: 'loop' | 'hold'
}

/**
 * Each file's playback copy: the scrub proxy (small, every frame a keyframe), which plays and seeks
 * smoothly where the original (4K at 60fps, keyframes seconds apart, several at once) can't. Kept
 * for the session. null: none could be made, so the file itself plays.
 */
const copies = new SvelteMap<string, string | null>()
const fileKey = (c: LayoutVideo) => `${c.path}|${c.mtime}`

/**
 * Playing a layout in the single view: one clock for the layout, and a video per video cell that
 * follows it, looping or holding exactly as the export does (see slotTime). Each plays from its
 * file's playback copy, made in the background on first open; until then the cell's thumbnail
 * stands in. Silent, as the export is for now. `frame` changes whenever there's something new to
 * draw. Call `destroy()` when done.
 */
export class LayoutPlayer {
  playing = $state(false)
  /** Seconds into the layout. */
  time = $state(0)
  frame = $state(0)

  private videos = new Map<string, { src: string; file: string; v: HTMLVideoElement }>()
  /**
   * Each cell's last frame, by slot (and which file it's from), drawn while its video has none to
   * give: mid-seek, or just swapped for its playback copy. Otherwise every scrub step would flash
   * the cell's still in between.
   */
  private shots = new Map<string, { file: string; c: OffscreenCanvas }>()
  /** A seek waiting for the one in flight to land; only the newest target is kept. */
  private pending = new Map<HTMLVideoElement, number>()
  private queue: LayoutVideo[] = []
  private working = false
  private alive = true
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
    this.alive = false
    this.stop()
    for (const { v } of this.videos.values()) releaseVideo(v)
    this.videos.clear()
    this.shots.clear()
  }

  /** How many cells are still waiting for their playback copy. */
  get preparing(): number {
    return new Set(
      this.cells()
        .filter((c) => copies.get(fileKey(c)) === undefined)
        .map(fileKey)
    ).size
  }

  /**
   * What to draw for a cell now: its video's frame, or while that's not there (seeking) the last one
   * it showed; null before it has shown any (its thumbnail stands in).
   */
  source(slot: string): CanvasImageSource | null {
    const have = this.videos.get(slot)
    if (!have) return null
    if (have.v.readyState >= 2 && !have.v.seeking) return have.v
    const shot = this.shots.get(slot)
    return shot?.file === have.file ? shot.c : null
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
    // A video per video cell, from its file's playback copy once there is one.
    $effect(() => {
      const wanted = this.cells().map((c) => {
        const copy = copies.get(fileKey(c))
        return { c, src: copy ? mediaUrl(copy) : copy === null ? mediaUrl(c.path) : null }
      })
      untrack(() => {
        const keep = new Set<string>()
        for (const { c, src } of wanted) {
          if (!src) {
            this.prepare(c)
            continue
          }
          keep.add(c.slot)
          const have = this.videos.get(c.slot)
          if (have?.src === src) continue
          if (have) this.release(have.v)
          const v = silentVideo(src)
          const file = fileKey(c)
          v.loop = false
          v.addEventListener('seeked', () => {
            // Keep the frame that landed before chasing a newer target, so scrubbing shows each.
            this.keep(c.slot, file, v)
            const next = this.pending.get(v)
            this.pending.delete(v)
            if (next != null) v.currentTime = next
            this.frame++
          })
          // Every frame it presents while playing, too.
          const onFrame = () => {
            if (this.videos.get(c.slot)?.v !== v) return
            this.keep(c.slot, file, v)
            v.requestVideoFrameCallback(onFrame)
          }
          v.requestVideoFrameCallback(onFrame)
          v.addEventListener('loadeddata', () => {
            this.sync(true)
            this.frame++
          })
          this.videos.set(c.slot, { src, file, v })
        }
        for (const [slot, { v }] of this.videos) {
          if (keep.has(slot)) continue
          this.release(v)
          this.videos.delete(slot)
          this.shots.delete(slot)
        }
        this.sync(true)
      })
    })

    // The clock: while playing, time runs and wraps at the layout's length; each video follows it.
    $effect(() => {
      if (!this.playing) {
        untrack(() => this.sync(true))
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

  /** Copies a video's current frame as its cell's last frame. */
  private keep(slot: string, file: string, v: HTMLVideoElement) {
    if (v.readyState < 2 || v.seeking || !v.videoWidth) return
    let shot = this.shots.get(slot)
    if (!shot || shot.c.width !== v.videoWidth || shot.c.height !== v.videoHeight) {
      shot = { file, c: new OffscreenCanvas(v.videoWidth, v.videoHeight) }
      this.shots.set(slot, shot)
    }
    shot.file = file
    shot.c.getContext('2d')!.drawImage(v, 0, 0)
  }

  private release(v: HTMLVideoElement) {
    this.pending.delete(v)
    releaseVideo(v)
  }

  /** Asks for a file's playback copy, one file at a time, for as long as this layout is open. */
  private prepare(c: LayoutVideo) {
    if (copies.has(fileKey(c)) || this.queue.some((q) => fileKey(q) === fileKey(c))) return
    this.queue.push(c)
    if (!this.working) this.work()
  }

  private async work() {
    this.working = true
    while (this.alive && this.queue.length) {
      const c = this.queue[0]
      if (!copies.has(fileKey(c))) {
        try {
          copies.set(fileKey(c), await api.scrubProxy(c.path, c.w, c.h, c.color))
        } catch (e) {
          if (!this.alive) break
          // Another view asked for one meanwhile (only the newest request builds): ask again shortly.
          if (/superseded/.test(String(e))) {
            await new Promise((r) => setTimeout(r, 400))
            continue
          }
          copies.set(fileKey(c), null)
        }
      }
      this.queue.shift()
    }
    this.working = false
  }

  /** Seeks there, or once the seek in flight lands (so a scrub never queues up a backlog). */
  private seekTo(v: HTMLVideoElement, t: number) {
    if (v.seeking) this.pending.set(v, t)
    else v.currentTime = t
  }

  /**
   * Each video to where it should be at the current time. While the clock runs a video plays along,
   * its speed nudged to close small drift (seeking only to jump, or when it's well off: a loop
   * coming round, say); a holding one stops on its last frame once it ends. Paused, each is seeked
   * there.
   */
  private sync(jump: boolean) {
    for (const c of this.cells()) {
      const v = this.videos.get(c.slot)?.v
      if (!v || v.readyState < 1) continue
      const t = slotTime(this.time, c.start, c.length, c.end)
      const held = c.end === 'hold' && this.time >= c.length
      if (!this.playing || held) {
        if (!v.paused) v.pause()
        v.playbackRate = 1
        if (Math.abs(v.currentTime - t) > 0.02 || this.pending.has(v)) this.seekTo(v, t)
        continue
      }
      const drift = v.currentTime - t
      if (jump || Math.abs(drift) > Math.min(0.5, c.length / 2)) {
        v.playbackRate = 1
        this.seekTo(v, t)
      } else if (!v.seeking) v.playbackRate = Math.abs(drift) < 0.03 ? 1 : Math.min(1.25, Math.max(0.8, 1 - drift * 2))
      if (v.paused) v.play().catch(() => {})
    }
  }
}
