import { untrack } from 'svelte'
import { slotTime } from '@shared/arrangement'
import { api, mediaUrl } from '../bridge'
import { Clip } from './clip.svelte'
import { copies, sizeFor, sizesOf, type MediaFile } from './copies.svelte'

/**
 * Playback: one clock, and any number of videos following it. A single video in the single view is
 * one track; a layout is a track per video cell; anything later (sequences, sound mixes) is more of
 * the same. Pictures come from playback copies sized to what's on screen (see Copies), or one still
 * being made, streamed as it's written; zoomed in past them all, when the clock stops, from the
 * exact frame (decoded by ffmpeg the way export decodes, at screen size). Sound comes from the original file, apart
 * from the pictures, so pictures can come from any copy. Call `destroy()` when done.
 */

/** A video following the clock. */
export interface Track {
  id: string
  file: MediaFile
  /** The stretch of the file it plays (seconds), and what it does once the clock runs past it. */
  start: number
  length: number
  end: 'loop' | 'hold'
  /** Device pixels its picture covers on screen (so which copy is sharp enough). */
  need: number
}

export interface PlaybackOptions {
  tracks: () => Track[]
  /** The stretch of the clock that plays, looping round (seconds). */
  range: () => { start: number; end: number }
  /** Sound, from one track's original file, at a volume (0: none). */
  sound?: () => { track: string; volume: number } | null
  /** Stop and stay stopped (the eyedropper is reading the screen). */
  hold?: () => boolean
  /**
   * While a track's copy is being made, play its original. Fine for one video on screen; several
   * 4K originals at once are what copies are for, so their thumbnails stand in instead.
   */
  originals?: boolean
}

/** How long the clock rests before exact frames are fetched (only where no copy is sharp enough). */
const SETTLE = 300

export class Playback {
  playing = $state(false)
  /** Where the clock is (seconds). */
  time = $state(0)
  scrubbing = $state(false)

  private clips = new Map<string, Clip>()
  private wants = new Map<string, () => void>()
  /** The exact frame for each track, where the clock rests. */
  private exact = new Map<string, { at: number; edge: number; bitmap: ImageBitmap }>()
  /** Bumped when exact frames arrive, or clips come and go. */
  private changed = $state(0)
  private previews = new Map<string, Clip>()
  /**
   * While scrubbing, a track whose copy is bigger than its smallest shows a second video on that
   * smallest one (seeks on a big copy cost the decoder a restart each; small ones are quick); its
   * own video seeks once, where the scrub ends. Kept for the next scrub.
   */
  private scrubs = new Map<string, Clip>()
  private audio: { path: string; el: HTMLAudioElement } | null = null
  private resume = false
  private startedAt = 0
  private startedTime = 0
  private stop: () => void
  private opts: PlaybackOptions
  /** Each instance's frame requests are its own (a newer one stops only its own older one). */
  private tag = Math.random().toString(36).slice(2)

  constructor(opts: PlaybackOptions) {
    this.opts = opts
    this.stop = $effect.root(() => this.effects())
  }

  destroy(): void {
    this.stop()
    for (const c of [...this.clips.values(), ...this.previews.values(), ...this.scrubs.values()]) c.release()
    for (const w of this.wants.values()) w()
    for (const e of this.exact.values()) e.bitmap.close()
    this.audio?.el.pause()
    this.audio?.el.removeAttribute('src')
    this.clips.clear()
    this.previews.clear()
    this.scrubs.clear()
    this.wants.clear()
    this.exact.clear()
  }

  /** Changes whenever anything there is to draw does. */
  get version(): number {
    let v = this.changed
    for (const c of this.clips.values()) v += c.version
    for (const c of this.scrubs.values()) v += c.version
    return v
  }

  /**
   * What to draw for a track now: its exact frame while the clock rests on it, else its video's
   * frame (or the last one, mid-seek); null before it has any (its thumbnail stands in).
   */
  frame(id: string): CanvasImageSource | null {
    if (!this.playing && !this.scrubbing) {
      const e = this.exact.get(id)
      const t = this.trackTime(id)
      if (e && t != null && Math.abs(e.at - t) < 0.001) return e.bitmap
    }
    const main = this.clips.get(id)
    // Scrubbing, and until its own video has caught up with where the scrub ended.
    const scrub = this.scrubs.get(id)
    if (scrub && (this.scrubbing || main?.seeking)) {
      const f = scrub.frame()
      if (f) return f
    }
    return main?.frame() ?? null
  }

  /** Playing, with a track that has nothing to show yet. */
  get waiting(): boolean {
    return this.playing && [...this.clips.values()].some((c) => !c.ready)
  }

  toggle(): void {
    const { start, end } = this.opts.range()
    if (end - start <= 0) return
    this.playing = !this.playing
  }

  /** To `t` on the clock (the stretch that plays loops; seeking can go anywhere). */
  seek(t: number): void {
    this.time = Math.max(0, t)
    if (this.playing) {
      this.startedAt = performance.now()
      this.startedTime = this.time
    }
    this.sync(true)
  }

  // Scrubbing: playback pauses for the drag and resumes after; every move seeks (newest wins).
  scrubStart(): void {
    this.resume = this.playing
    this.playing = false
    this.scrubbing = true
    for (const t of this.opts.tracks()) {
      const small = copies.best(t.file, sizesOf(t.file)[0])
      const own = copies.best(t.file, sizeFor(t.file, t.need))
      // Already on the smallest there is: its own video is as quick to scrub as any.
      if (!small || !own || small.size >= own.size) continue
      let c = this.scrubs.get(t.id)
      if (!c) this.scrubs.set(t.id, (c = new Clip()))
      c.setSource(small.url)
      this.changed++
    }
    this.sync(true)
  }

  scrubTo(t: number): void {
    this.seek(t)
  }

  scrubEnd(t: number): void {
    this.scrubbing = false
    this.seek(t)
    if (this.resume) this.playing = true
  }

  /**
   * Draws a track's frame at `t` (its own time) with `draw`, from a second video, so the view never
   * has to seek mid-drag: the trim handles' previews. From its smallest copy (they're small).
   */
  preview(id: string, t: number, draw: (src: CanvasImageSource) => void): void {
    const track = this.opts.tracks().find((x) => x.id === id)
    if (!track) return
    let c = this.previews.get(id)
    if (!c) this.previews.set(id, (c = new Clip()))
    const copy = copies.best(track.file, sizesOf(track.file)[0])
    c.setSource(copy?.url ?? mediaUrl(track.file.path))
    c.onframe = () => {
      const f = c.frame()
      if (f) draw(f)
    }
    c.seek(t)
    const f = c.frame()
    if (f) draw(f)
  }

  /** Where a track is in its own file at the clock's time (null: no such track). */
  private trackTime(id: string): number | null {
    const t = this.opts.tracks().find((x) => x.id === id)
    return t ? slotTime(this.time, t.start, t.length, t.end) : null
  }

  private effects() {
    // A clip per track, each shown from the best copy there is for its size on screen (asking for
    // that size), or meanwhile the original where that's allowed.
    $effect(() => {
      const tracks = this.opts.tracks().map((t) => {
        const size = sizeFor(t.file, t.need)
        const copy = copies.best(t.file, size)
        // No copy yet: the one being made, as it's written (only the part encoded so far plays, but
        // smoothly, and it's always ahead of playback); else the original, where that's allowed.
        const stream = copy ? null : copies.streaming(t.file)
        const original = this.opts.originals || copies.failed(t.file)
        return { t, size, stream: !!stream, url: copy?.url ?? stream?.url ?? (original ? mediaUrl(t.file.path) : null) }
      })
      untrack(() => {
        const keep = new Set<string>()
        const wanted = new Set<string>()
        for (const { t, size, stream, url } of tracks) {
          keep.add(t.id)
          const key = `${t.id}|${t.file.path}|${t.file.mtime}|${size}`
          wanted.add(key)
          if (!this.wants.has(key)) this.wants.set(key, copies.want(t.file, size))
          let c = this.clips.get(t.id)
          if (!c) {
            this.clips.set(t.id, (c = new Clip()))
            this.changed++
          }
          c.onerror = (bad) => copies.lost(t.file, bad)
          if (url) c.setSource(url, stream ? { duration: t.file.duration } : undefined)
        }
        for (const [key, withdraw] of this.wants) {
          if (wanted.has(key)) continue
          withdraw()
          this.wants.delete(key)
        }
        for (const [id, c] of this.clips) {
          if (keep.has(id)) continue
          c.release()
          this.clips.delete(id)
          this.scrubs.get(id)?.release()
          this.scrubs.delete(id)
          this.exact.get(id)?.bitmap.close()
          this.exact.delete(id)
          this.changed++
        }
        this.sync(true)
      })
    })

    // Playing or scrubbing: making copies for anything not on screen waits.
    $effect(() => {
      if (this.playing || this.scrubbing) return untrack(() => copies.busy())
    })

    // The eyedropper reads the screen: stop on the exact frame.
    $effect(() => {
      if (this.opts.hold?.() && untrack(() => this.playing)) this.playing = false
    })

    // The clock: while playing, time runs and wraps round the stretch that plays; tracks follow.
    $effect(() => {
      if (!this.playing) {
        untrack(() => {
          for (const c of this.clips.values()) c.pause()
          this.audio?.el.pause()
          this.sync(true)
        })
        return
      }
      untrack(() => {
        const { start, end } = this.opts.range()
        // From the start when stopped at (or past) the end, or outside the stretch.
        if (this.time < start || this.time >= end - 0.01) this.time = start
        this.startedAt = performance.now()
        this.startedTime = this.time
      })
      let raf = 0
      let last = untrack(() => this.time)
      const tick = () => {
        const { start, end } = this.opts.range()
        const span = end - start
        if (span <= 0) return void (this.playing = false)
        const t = start + ((((this.startedTime - start + (performance.now() - this.startedAt) / 1000) % span) + span) % span)
        this.time = t
        // Wrapped round: everything starts over together.
        this.sync(t < last)
        last = t
        raf = requestAnimationFrame(tick)
      }
      // From the next frame: ticking here would make this effect depend on what it sets.
      raf = requestAnimationFrame(tick)
      return () => cancelAnimationFrame(raf)
    })

    // Sound: the chosen track's original, following the clock.
    $effect(() => {
      const s = this.opts.sound?.()
      const track = s ? this.opts.tracks().find((t) => t.id === s.track) : undefined
      untrack(() => {
        const path = track?.file.path ?? null
        if (this.audio && this.audio.path !== path) {
          this.audio.el.pause()
          this.audio.el.removeAttribute('src')
          this.audio = null
        }
        if (!path || !s) return
        if (!this.audio) {
          const el = new Audio(mediaUrl(path))
          el.preload = 'auto'
          this.audio = { path, el }
        }
        this.audio.el.volume = Math.min(1, Math.max(0, s.volume))
        this.audio.el.muted = s.volume === 0
        this.sync(true)
      })
    })

    // At rest, the exact frame (decoded from the original by ffmpeg) for each track no copy is sharp
    // enough for: none made yet, or zoomed in past them all. Otherwise the copy's own frame is exact
    // already (copies are converted as export converts), and costs nothing.
    $effect(() => {
      if (this.playing || this.scrubbing) return
      void this.time
      const tracks = this.opts.tracks()
      let alive = true
      const timer = setTimeout(() => {
        for (const t of tracks) {
          if (untrack(() => copies.sharp(t.file, t.need))) continue
          const at = slotTime(
            untrack(() => this.time),
            t.start,
            t.length,
            t.end
          )
          // In 256px steps (and never past the file's own size), so small zooms don't refetch.
          const edge = Math.min(Math.max(t.file.w, t.file.h), Math.ceil(Math.max(256, t.need) / 256) * 256)
          const have = this.exact.get(t.id)
          if (have && Math.abs(have.at - at) < 0.001 && have.edge >= edge) continue
          api
            .frame(t.file.path, at, t.file.color, `${this.tag}:${t.id}`, edge)
            .then((jpeg) => (jpeg ? createImageBitmap(new Blob([jpeg as BlobPart], { type: 'image/jpeg' })) : null))
            .then((bitmap) => {
              // Superseded by a newer request.
              if (!bitmap) return
              if (!alive || this.playing || this.scrubbing) return bitmap.close()
              this.exact.get(t.id)?.bitmap.close()
              this.exact.set(t.id, { at, edge, bitmap })
              this.changed++
            })
            .catch(() => {})
        }
      }, SETTLE)
      return () => {
        alive = false
        clearTimeout(timer)
      }
    })
  }

  /**
   * Each track to where it should be at the clock's time: following it while it runs (a holding one
   * stops on its last frame once it ends), or seeked there when it's stopped. Sound likewise.
   */
  private sync(jump: boolean) {
    const tracks = this.opts.tracks()
    for (const t of tracks) {
      const c = this.clips.get(t.id)
      if (!c) continue
      const at = slotTime(this.time, t.start, t.length, t.end)
      const held = t.end === 'hold' && this.time >= t.length
      const scrub = this.scrubs.get(t.id)
      if (this.scrubbing && scrub) {
        scrub.seek(at)
        continue
      }
      if (!this.playing || held) {
        c.pause()
        c.setRate(1)
        c.seek(at)
      } else c.follow(at, jump, t.length)
    }
    const a = this.audio?.el
    const s = this.opts.sound?.()
    const track = s && tracks.find((t) => t.id === s.track)
    if (!a || !track) return
    // Silent while scrubbing; it seeks once, where the scrub ends.
    if (this.scrubbing) return void a.pause()
    const at = slotTime(this.time, track.start, track.length, track.end)
    if (!this.playing) {
      a.pause()
      if (Math.abs(a.currentTime - at) > 0.05) a.currentTime = at
      return
    }
    // Sound is heard: seek only when well off (a loop coming round), else let it run.
    if (jump || Math.abs(a.currentTime - at) > 0.2) a.currentTime = at
    if (a.paused) a.play().catch(() => {})
  }
}
