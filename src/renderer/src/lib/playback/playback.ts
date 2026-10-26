import { slotTime } from '@shared/arrangement'
import { Clip, type ClipLike } from './clip'
import { sizeFor, sizesOf, type Copies, type MediaFile } from './copies'
import { Emitter } from './emitter'
import type { MediaHost } from './host'

/**
 * Playback: one clock, and any number of videos following it. A single video in the single view is
 * one track; a layout is a track per video cell; anything later (sequences, sound mixes) is more of
 * the same. Pictures come from playback copies sized to what's on screen (see Copies), or one still
 * being made, streamed as it's written; zoomed in past them all, when the clock stops, from the
 * exact frame (decoded by ffmpeg the way export decodes, at screen size). Sound comes from the
 * original file, apart from the pictures, so pictures can come from any copy.
 *
 * Plain TypeScript: it's told what to play through its methods (`setTracks`, `setRange`,
 * `setSound`, `setHold`, `play`, `seek`, `scrub*`) and says when anything there is to show changed
 * through `changed`. Call `destroy()` when done.
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

/** The stretch of the clock that plays, looping round (seconds). */
export interface Range {
  start: number
  end: number
}

/** Sound, from one track's original file, at a volume (0: none). */
export interface Sound {
  track: string
  volume: number
}

/** Time, animation frames and timers, so tests can run the clock by hand. */
export interface Scheduler {
  now(): number
  /** Calls `cb` on the next animation frame; gives back a function that cancels it. */
  frame(cb: () => void): () => void
  /** Calls `cb` after `ms`; gives back a function that cancels it. */
  later(cb: () => void, ms: number): () => void
}

const browserScheduler: Scheduler = {
  now: () => performance.now(),
  frame: (cb) => {
    const id = requestAnimationFrame(cb)
    return () => cancelAnimationFrame(id)
  },
  later: (cb, ms) => {
    const id = setTimeout(cb, ms)
    return () => clearTimeout(id)
  }
}

export interface PlaybackOptions {
  copies: Copies
  host: MediaHost
  /**
   * While a track's copy is being made, play its original. Fine for one video on screen; several
   * 4K originals at once are what copies are for, so their thumbnails stand in instead.
   */
  originals?: boolean
  /** Makes the clips tracks play through (fakes in tests). */
  clip?: () => ClipLike
  scheduler?: Scheduler
  /** Makes the element sound plays from. */
  audio?: (url: string) => HTMLAudioElement
}

/** How long the clock rests before exact frames are fetched (only where no copy is sharp enough). */
const SETTLE = 300

export class Playback {
  /** Anything there is to show changed: the time, playing, scrubbing, a new frame. */
  readonly changed = new Emitter()

  private _playing = false
  private _time = 0
  private _scrubbing = false
  private _version = 0

  private tracks: Track[] = []
  private range: Range = { start: 0, end: 0 }
  private sound: Sound | null = null
  private holding = false

  private clips = new Map<string, ClipLike>()
  /** Each clip's frame subscription. */
  private listening = new Map<ClipLike, () => void>()
  private wants = new Map<string, () => void>()
  /** The exact frame for each track, where the clock rests. */
  private exact = new Map<string, { at: number; edge: number; bitmap: ImageBitmap }>()
  private previews = new Map<string, { clip: ClipLike; draw: (src: CanvasImageSource) => void; off: () => void }>()
  /**
   * While scrubbing, a track whose copy is bigger than its smallest shows a second video on that
   * smallest one (seeks on a big copy cost the decoder a restart each; small ones are quick); its
   * own video seeks once, where the scrub ends. Kept for the next scrub.
   */
  private scrubs = new Map<string, ClipLike>()
  private audio: { path: string; el: HTMLAudioElement } | null = null
  private resume = false
  private startedAt = 0
  private startedTime = 0
  private last = 0
  private stopTick: (() => void) | null = null
  private stopExact: (() => void) | null = null
  /** Bumped whenever exact frames asked for earlier stop being wanted. */
  private exactGen = 0
  private unbusy: (() => void) | null = null
  private unlisten: () => void
  private destroyed = false
  private copies: Copies
  private host: MediaHost
  private sched: Scheduler
  private makeClip: () => ClipLike
  private makeAudio: (url: string) => HTMLAudioElement
  /** Each instance's frame requests are its own (a newer one stops only its own older one). */
  private tag = Math.random().toString(36).slice(2)

  constructor(private opts: PlaybackOptions) {
    this.copies = opts.copies
    this.host = opts.host
    this.sched = opts.scheduler ?? browserScheduler
    this.makeClip = opts.clip ?? (() => new Clip())
    this.makeAudio =
      opts.audio ??
      ((url) => {
        const el = new Audio(url)
        el.preload = 'auto'
        return el
      })
    // A copy made, a stream started or a copy given up on can change what each track plays from.
    this.unlisten = this.copies.changed.on(() => this.refresh())
  }

  get playing(): boolean {
    return this._playing
  }

  /** Where the clock is (seconds). */
  get time(): number {
    return this._time
  }

  get scrubbing(): boolean {
    return this._scrubbing
  }

  /** Changes whenever anything there is to draw does. */
  get version(): number {
    return this._version
  }

  /** Playing, with a track that has nothing to show yet. */
  get waiting(): boolean {
    return this._playing && [...this.clips.values()].some((c) => !c.ready)
  }

  // ---------- inputs ----------

  /** What plays. The same tracks again (a re-render) change nothing that's playing. */
  setTracks(tracks: Track[]): void {
    this.tracks = tracks
    this.refresh()
    this.updateSound()
    this.scheduleExact()
  }

  setRange(range: Range): void {
    this.range = range
  }

  setSound(sound: Sound | null): void {
    if (sound?.track === this.sound?.track && sound?.volume === this.sound?.volume) return
    this.sound = sound
    this.updateSound()
  }

  /** Stops, and stays stopped while it holds (the eyedropper is reading the screen). */
  setHold(hold: boolean): void {
    this.holding = hold
    if (hold) this.pause()
  }

  toggle(): void {
    if (this._playing) this.pause()
    else this.play()
  }

  play(): void {
    const { start, end } = this.range
    if (this._playing || this.holding || end - start <= 0 || this.destroyed) return
    this._playing = true
    // From the start when stopped at (or past) the end, or outside the stretch.
    if (this._time < start || this._time >= end - 0.01) this._time = start
    this.startedAt = this.sched.now()
    this.startedTime = this._time
    this.last = this._time
    this.cancelExact()
    this.updateBusy()
    // From the next frame on.
    this.stopTick = this.sched.frame(this.tick)
    this.notify()
  }

  pause(): void {
    if (!this._playing) return
    this._playing = false
    this.stopTick?.()
    this.stopTick = null
    for (const c of this.clips.values()) c.pause()
    this.audio?.el.pause()
    this.sync(true)
    this.updateBusy()
    this.scheduleExact()
    this.notify()
  }

  /** To `t` on the clock (the stretch that plays loops; seeking can go anywhere). */
  seek(t: number): void {
    this._time = Math.max(0, t)
    if (this._playing) {
      this.startedAt = this.sched.now()
      this.startedTime = this._time
    }
    this.sync(true)
    this.scheduleExact()
    this.notify()
  }

  // Scrubbing: playback pauses for the drag and resumes after; every move seeks (newest wins).
  scrubStart(): void {
    this.resume = this._playing
    this._scrubbing = true
    this.pause()
    for (const t of this.tracks) {
      const small = this.copies.best(t.file, sizesOf(t.file)[0])
      const own = this.copies.best(t.file, sizeFor(t.file, t.need))
      // Already on the smallest there is: its own video is as quick to scrub as any.
      if (!small || !own || small.size >= own.size) continue
      let c = this.scrubs.get(t.id)
      if (!c) this.scrubs.set(t.id, (c = this.newClip()))
      c.setSource(small.url)
      this._version++
    }
    this.sync(true)
    this.updateBusy()
    this.notify()
  }

  scrubTo(t: number): void {
    this.seek(t)
  }

  scrubEnd(t: number): void {
    this._scrubbing = false
    this.seek(t)
    this.updateBusy()
    if (this.resume) this.play()
    this.notify()
  }

  // ---------- outputs ----------

  /**
   * What to draw for a track now: its exact frame while the clock rests on it, else its video's
   * frame (or the last one, mid-seek); null before it has any (its thumbnail stands in).
   */
  frame(id: string): CanvasImageSource | null {
    if (!this._playing && !this._scrubbing) {
      const e = this.exact.get(id)
      const t = this.trackTime(id)
      if (e && t != null && Math.abs(e.at - t) < 0.001) return e.bitmap
    }
    const main = this.clips.get(id)
    // Scrubbing, and until its own video has caught up with where the scrub ended.
    const scrub = this.scrubs.get(id)
    if (scrub && (this._scrubbing || main?.seeking)) {
      const f = scrub.frame()
      if (f) return f
    }
    return main?.frame() ?? null
  }

  /**
   * Draws a track's frame at `t` (its own time) with `draw`, from a second video, so the view never
   * has to seek mid-drag: the trim handles' previews. From its smallest copy (they're small).
   */
  preview(id: string, t: number, draw: (src: CanvasImageSource) => void): void {
    const track = this.tracks.find((x) => x.id === id)
    if (!track) return
    let p = this.previews.get(id)
    if (!p) {
      const clip = this.makeClip()
      const entry = {
        clip,
        draw,
        off: clip.frames.on(() => {
          const f = clip.frame()
          if (f) entry.draw(f)
        })
      }
      this.previews.set(id, (p = entry))
    }
    p.draw = draw
    const copy = this.copies.best(track.file, sizesOf(track.file)[0])
    p.clip.setSource(copy?.url ?? this.host.url(track.file.path))
    p.clip.seek(t)
    const f = p.clip.frame()
    if (f) draw(f)
  }

  destroy(): void {
    this.destroyed = true
    this.stopTick?.()
    this.cancelExact()
    this.unlisten()
    this.unbusy?.()
    this.unbusy = null
    for (const c of [...this.clips.values(), ...this.scrubs.values()]) this.dropClip(c)
    for (const p of this.previews.values()) {
      p.off()
      p.clip.release()
    }
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

  // ---------- inside ----------

  private notify() {
    if (!this.destroyed) this.changed.emit()
  }

  /** A clip whose new frames are announced as this playback's. */
  private newClip(): ClipLike {
    const c = this.makeClip()
    this.listening.set(
      c,
      c.frames.on(() => {
        this._version++
        this.notify()
      })
    )
    return c
  }

  private dropClip(c: ClipLike) {
    this.listening.get(c)?.()
    this.listening.delete(c)
    c.release()
  }

  /** While playing or scrubbing, copies for anything not on screen wait. */
  private updateBusy() {
    const busy = this._playing || this._scrubbing
    if (busy && !this.unbusy) this.unbusy = this.copies.busy()
    else if (!busy && this.unbusy) {
      this.unbusy()
      this.unbusy = null
    }
  }

  /** While playing: time runs and wraps round the stretch that plays; tracks follow. */
  private tick = () => {
    this.stopTick = null
    if (!this._playing) return
    const { start, end } = this.range
    const span = end - start
    if (span <= 0) return this.pause()
    const t = start + ((((this.startedTime - start + (this.sched.now() - this.startedAt) / 1000) % span) + span) % span)
    this._time = t
    // Wrapped round: everything starts over together.
    this.sync(t < this.last)
    this.last = t
    this.stopTick = this.sched.frame(this.tick)
    this.notify()
  }

  /**
   * A clip per track, each shown from the best copy there is for its size on screen (asking for
   * that size), or meanwhile the copy being made as it's written, or the original where that's
   * allowed. Run when the tracks change and when the copies do.
   */
  private refresh() {
    if (this.destroyed) return
    const keep = new Set<string>()
    const wanted = new Set<string>()
    // Whether any clip came, went or changed source: only then is everything put back in step.
    let moved = false
    for (const t of this.tracks) {
      const size = sizeFor(t.file, t.need)
      const copy = this.copies.best(t.file, size)
      const stream = copy ? null : this.copies.streamUrl(t.file)
      const original = this.opts.originals || this.copies.failed(t.file)
      const url = copy?.url ?? stream ?? (original ? this.host.url(t.file.path) : null)
      keep.add(t.id)
      const key = `${t.id}|${t.file.path}|${t.file.mtime}|${size}`
      wanted.add(key)
      if (!this.wants.has(key)) this.wants.set(key, this.copies.want(t.file, size))
      let c = this.clips.get(t.id)
      if (!c) {
        this.clips.set(t.id, (c = this.newClip()))
        this._version++
        moved = true
      }
      const file = t.file
      c.onerror = (bad) => this.copies.lost(file, bad)
      if (url && c.setSource(url, stream ? { duration: t.file.duration } : undefined)) moved = true
    }
    for (const [key, withdraw] of this.wants) {
      if (wanted.has(key)) continue
      withdraw()
      this.wants.delete(key)
    }
    for (const [id, c] of this.clips) {
      if (keep.has(id)) continue
      this.dropClip(c)
      this.clips.delete(id)
      const s = this.scrubs.get(id)
      if (s) this.dropClip(s)
      this.scrubs.delete(id)
      this.exact.get(id)?.bitmap.close()
      this.exact.delete(id)
      this._version++
      moved = true
    }
    // A trim or a cell's timing changing (the tracks change, the clips don't) is followed by
    // playback's own correction; jumping would seek every video for nothing.
    this.sync(moved)
    if (moved) this.notify()
  }

  /** Sound: the chosen track's original, following the clock. */
  private updateSound() {
    const s = this.sound
    const track = s ? this.tracks.find((t) => t.id === s.track) : undefined
    const path = track?.file.path ?? null
    if (this.audio && this.audio.path !== path) {
      this.audio.el.pause()
      this.audio.el.removeAttribute('src')
      this.audio = null
    }
    if (!path || !s) return
    const fresh = !this.audio
    if (!this.audio) this.audio = { path, el: this.makeAudio(this.host.url(path)) }
    this.audio.el.volume = Math.min(1, Math.max(0, s.volume))
    this.audio.el.muted = s.volume === 0
    // New sound starts in step; a volume change needs no seek.
    if (fresh) this.sync(true)
  }

  private cancelExact() {
    this.exactGen++
    this.stopExact?.()
    this.stopExact = null
  }

  /**
   * At rest, the exact frame (decoded from the original by ffmpeg) for each track no copy is sharp
   * enough for: none made yet, or zoomed in past them all. Otherwise the copy's own frame is exact
   * already (copies are converted as export converts), and costs nothing.
   */
  private scheduleExact() {
    this.cancelExact()
    if (this._playing || this._scrubbing || this.destroyed) return
    const gen = this.exactGen
    this.stopExact = this.sched.later(() => {
      this.stopExact = null
      for (const t of this.tracks) {
        if (this.copies.sharp(t.file, t.need)) continue
        const at = slotTime(this._time, t.start, t.length, t.end)
        // In 256px steps (and never past the file's own size), so small zooms don't refetch.
        const edge = Math.min(Math.max(t.file.w, t.file.h), Math.ceil(Math.max(256, t.need) / 256) * 256)
        const have = this.exact.get(t.id)
        if (have && Math.abs(have.at - at) < 0.001 && have.edge >= edge) continue
        this.host
          .frame(t.file.path, at, t.file.color, `${this.tag}:${t.id}`, edge)
          .then((jpeg) => (jpeg ? createImageBitmap(new Blob([jpeg as BlobPart], { type: 'image/jpeg' })) : null))
          .then((bitmap) => {
            // Superseded by a newer request.
            if (!bitmap) return
            if (gen !== this.exactGen || this.destroyed) return bitmap.close()
            this.exact.get(t.id)?.bitmap.close()
            this.exact.set(t.id, { at, edge, bitmap })
            this._version++
            this.notify()
          })
          .catch(() => {})
      }
    }, SETTLE)
  }

  /** Where a track is in its own file at the clock's time (null: no such track). */
  private trackTime(id: string): number | null {
    const t = this.tracks.find((x) => x.id === id)
    return t ? slotTime(this._time, t.start, t.length, t.end) : null
  }

  /**
   * Each track to where it should be at the clock's time: following it while it runs (a holding one
   * stops on its last frame once it ends), or seeked there when it's stopped. Sound likewise.
   */
  private sync(jump: boolean) {
    for (const t of this.tracks) {
      const c = this.clips.get(t.id)
      if (!c) continue
      const at = slotTime(this._time, t.start, t.length, t.end)
      const held = t.end === 'hold' && this._time >= t.length
      const scrub = this.scrubs.get(t.id)
      if (this._scrubbing && scrub) {
        scrub.seek(at)
        continue
      }
      if (!this._playing || held) {
        c.pause()
        c.setRate(1)
        c.seek(at)
      } else c.follow(at, jump, t.length)
    }
    const a = this.audio?.el
    const s = this.sound
    const track = s && this.tracks.find((t) => t.id === s.track)
    if (!a || !track) return
    // Silent while scrubbing; it seeks once, where the scrub ends.
    if (this._scrubbing) return void a.pause()
    const at = slotTime(this._time, track.start, track.length, track.end)
    if (!this._playing) {
      a.pause()
      if (Math.abs(a.currentTime - at) > 0.05) a.currentTime = at
      return
    }
    // Sound is heard: seek only when well off (a loop coming round), else let it run.
    if (jump || Math.abs(a.currentTime - at) > 0.2) a.currentTime = at
    if (a.paused) a.play().catch(() => {})
  }
}
