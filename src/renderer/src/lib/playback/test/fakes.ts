import type { ClipLike } from '../clip'
import type { MediaFile } from '../copies'
import { Emitter } from '../emitter'
import type { MediaHost } from '../host'
import type { Scheduler } from '../playback'

/** Stand-ins for what the engine is given (the media worker, video elements, the clock), driven by hand. */

/** A 4K video (copies at 960 and 1920). */
export const video = (name: string, duration = 10): MediaFile => ({ path: `/v/${name}`, mtime: 1, w: 3840, h: 2160, duration })

/** Lets pending promises and microtasks run. */
export async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve()
}

export interface CopyCall {
  id: number
  path: string
  edge: number
  background: boolean
  stream: boolean
  done: boolean
  finish(path: string | null): void
  fail(): void
}

/**
 * A media worker: copies listed in `made` ("/v/a@960") exist already; others are made only when the
 * test finishes them (`running.finish(path)`).
 */
export function fakeHost(opts: { made?: string[]; streams?: boolean } = {}) {
  const made = new Set(opts.made ?? [])
  const calls: CopyCall[] = []
  let progress: ((p: { id: number; progress: number; stream?: string }) => void) | null = null
  let cancels = 0
  const host: MediaHost = {
    url: (p) => `media:${p}`,
    streams: opts.streams ?? false,
    copy: (id, path, _w, _h, _color, edge, _duration, background, stream) =>
      new Promise<string | null>((resolve, reject) => {
        const call: CopyCall = {
          id,
          path,
          edge,
          background,
          stream,
          done: false,
          finish: (p) => {
            call.done = true
            resolve(p)
          },
          fail: () => {
            call.done = true
            reject(new Error('could not make it'))
          }
        }
        calls.push(call)
      }),
    copiesMade: async (list) => list.map(({ path, edge }) => (made.has(`${path}@${edge}`) ? `/copies${path}@${edge}.mp4` : null)),
    cancelCopy: () => {
      cancels++
      for (const c of calls) if (!c.done) c.finish(null)
    },
    onCopyProgress: (cb) => {
      progress = cb
      return () => (progress = null)
    },
    frame: async () => null
  }
  return {
    host,
    calls,
    get cancels() {
      return cancels
    },
    /** The copy being made now, if any. */
    get running(): CopyCall | undefined {
      return calls.find((c) => !c.done)
    },
    progress: (p: { id: number; progress: number; stream?: string }) => progress?.(p)
  }
}

/** A clip that records what it's told. Ready (with a frame) once it has a source. */
export class FakeClip implements ClipLike {
  version = 0
  readonly frames = new Emitter()
  onerror: ((url: string) => void) | null = null
  src = ''
  stream = false
  sources = 0
  seeks: number[] = []
  follows: { t: number; jump: boolean }[] = []
  playing = false
  released = false

  get ready(): boolean {
    return !!this.src
  }

  get seeking(): boolean {
    return false
  }

  setSource(url: string, stream?: { duration: number }): boolean {
    if (url === this.src) return false
    this.src = url
    this.stream = !!stream
    this.sources++
    this.version++
    this.frames.emit()
    return true
  }

  frame(): CanvasImageSource | null {
    return this.src ? ({ src: this.src } as unknown as CanvasImageSource) : null
  }

  /** Where it is: a seek to there changes nothing (as with a real clip). */
  private at: number | null = null

  seek(t: number): void {
    if (this.at !== null && Math.abs(t - this.at) <= 0.001) return
    this.at = t
    this.seeks.push(t)
  }

  play(): void {
    this.playing = true
  }

  pause(): void {
    this.playing = false
  }

  setRate(): void {}

  follow(t: number, jump: boolean): void {
    this.at = t
    this.follows.push({ t, jump })
    this.playing = true
  }

  release(): void {
    this.released = true
  }
}

/** A clock that only moves when told: `advance(ms)` runs the timers due, then one animation frame. */
export function manualClock() {
  let now = 0
  let frames: (() => void)[] = []
  let timers: { at: number; cb: () => void }[] = []
  const scheduler: Scheduler = {
    now: () => now,
    frame: (cb) => {
      frames.push(cb)
      return () => void (frames = frames.filter((f) => f !== cb))
    },
    later: (cb, ms) => {
      const t = { at: now + ms, cb }
      timers.push(t)
      return () => void (timers = timers.filter((x) => x !== t))
    }
  }
  return {
    scheduler,
    advance(ms: number) {
      now += ms
      const due = timers.filter((t) => t.at <= now)
      timers = timers.filter((t) => t.at > now)
      for (const t of due) t.cb()
      const f = frames
      frames = []
      for (const cb of f) cb()
    }
  }
}
