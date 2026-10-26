import { SvelteMap, SvelteSet } from 'svelte/reactivity'
import type { ColorMeta } from '@shared/types'
import { api, mediaUrl } from '../bridge'

/** A video file as playback knows it. */
export interface MediaFile {
  path: string
  mtime: number
  w: number
  h: number
  duration: number
  color?: ColorMeta
}

/** Long edges (pixels) copies are made at, each capped at the file's own. */
const SIZES = [960, 1920]
/** A copy this much smaller than what's on screen still looks sharp (and saves making a bigger one). */
const SLACK = 0.85

/** How soon a copy is needed: on screen now, likely next (a neighbour in the filmstrip), or some time. */
export const NOW = 0
export const SOON = 1
export const LATER = 2
/**
 * A sharper copy of something that already plays smoothly comes after the first copies of what's
 * likely next (stepping to a video that's ready beats extra sharpness: paused, the frame shown is
 * full resolution anyway), but before the rest.
 */
const SHARPER = 1.5
/** How long things stay still before copies for what isn't on screen are made again. */
const IDLE = 2000

/** The copy sizes a file can have, smallest first. */
export const sizesOf = (f: MediaFile): number[] => [...new Set(SIZES.map((s) => Math.min(s, Math.max(f.w, f.h))))]

/** The size to show `f` at when it covers `need` device pixels: the smallest that's sharp enough. */
export function sizeFor(f: MediaFile, need: number): number {
  const sizes = sizesOf(f)
  return sizes.find((s) => s >= need * SLACK) ?? sizes[sizes.length - 1]
}

const fileKey = (f: Pick<MediaFile, 'path' | 'mtime'>) => `${f.path}|${f.mtime}`
const copyKey = (f: MediaFile, size: number) => `${fileKey(f)}|${size}`

/** A copy to make, and how soon. */
interface Job {
  key: string
  file: MediaFile
  size: number
  priority: number
  since: number
}

/** What's happening to a file's copies, for showing it. */
export type CopyState = { state: 'making'; progress: number } | { state: 'queued' } | null

/**
 * The playback copies of video files: small, every frame a keyframe, so they play several at once
 * and seek instantly where originals (4K, 60fps, keyframes seconds apart) can't. Made by the media
 * worker one at a time, most urgent first: what's on screen now, then what's likely next, then
 * every other video in the folder, ahead of time, at low priority. Within each, smaller sizes first
 * (something playable soonest), then in the order asked. When something more urgent comes up while
 * a less urgent copy is being made, that one stops and waits its turn again, so what you're looking
 * at never waits behind anything. Copies are kept between sessions: opening a folder first asks
 * which are made already.
 */
class Copies {
  /** By file and size: the copy's path, or null (none could be made). */
  private made = new SvelteMap<string, string | null>()
  /** Files whose made copies have been looked up, and those being looked up. */
  private checked = new SvelteSet<string>()
  private checking = new SvelteSet<string>()
  private toCheck: MediaFile[] = []
  /** Asked for by what's showing (on screen now, or likely next), with how many ask. */
  private wanted = new SvelteMap<string, { job: Job; refs: number }>()
  /** Every video in the folder, made ahead of time at the smallest size. */
  private ahead = $state.raw<MediaFile[]>([])
  /** The copy being made. */
  private current = $state.raw<{ id: number; job: Job; progress: number } | null>(null)
  private ids = 0
  private asked = 0
  private stopping = 0
  private running = false
  /** Copies made since there was last nothing to do, for overall progress. */
  private finished = new SvelteSet<string>()
  /** Something is playing or being scrubbed: only what's on screen is made meanwhile. */
  private playing = $state(0)
  /** And for a moment after (pausing, stepping to another video), so it isn't started only to be stopped. */
  private settling = $state(false)
  private settle: ReturnType<typeof setTimeout> | undefined
  /** Copies that failed to load, by file and size, and how often. */
  private losses = new Map<string, number>()

  constructor() {
    api.onCopyProgress(({ id, progress }) => {
      if (this.current?.id === id) this.current = { ...this.current, progress }
    })
  }

  /**
   * Asks for `file` at `size` (and at its smallest size first, if that's not it), as soon as
   * `priority` says. Returns a function that withdraws the request: call it from an effect, so
   * it's withdrawn when whatever asked goes away.
   */
  want(file: MediaFile, size: number, priority = NOW): () => void {
    const smallest = sizesOf(file)[0]
    const sizes = [...new Set([smallest, size])]
    const keys = sizes.map((s) => `${copyKey(file, s)}#${priority}`)
    sizes.forEach((s, i) => {
      const w = this.wanted.get(keys[i])
      if (w) this.wanted.set(keys[i], { ...w, refs: w.refs + 1 })
      else
        this.wanted.set(keys[i], {
          job: { key: copyKey(file, s), file, size: s, priority: s === smallest ? priority : priority + SHARPER, since: ++this.asked },
          refs: 1
        })
    })
    this.check([file])
    this.next()
    return () => {
      for (const k of keys) {
        const w = this.wanted.get(k)
        if (!w) continue
        if (w.refs <= 1) this.wanted.delete(k)
        else this.wanted.set(k, { ...w, refs: w.refs - 1 })
      }
      // What's being made may now matter less than what's waiting.
      this.preempt()
    }
  }

  /** Every video in the folder: each gets its smallest copy ahead of time. */
  prepare(files: MediaFile[]): void {
    this.ahead = files
    this.check(files)
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

  /** The file of the smallest copy made, if any (quick to read single frames from: every one's a keyframe). */
  smallest(file: MediaFile): string | null {
    for (const s of sizesOf(file)) {
      const path = this.made.get(copyKey(file, s))
      if (path) return path
    }
    return null
  }

  /** None could be made at any size (the original has to stand in). */
  failed(file: MediaFile): boolean {
    return sizesOf(file).every((s) => this.made.get(copyKey(file, s)) === null)
  }

  /** Whether `file` has nothing to show from yet, and one is on its way. */
  pending(file: MediaFile): boolean {
    return !this.best(file, 0) && !this.failed(file)
  }

  /** Whether `file` has a copy at `size` (or bigger) yet. */
  has(file: MediaFile, size: number): boolean {
    return sizesOf(file).some((s) => s >= size && !!this.made.get(copyKey(file, s)))
  }

  /** Whether a copy made already looks sharp covering `need` device pixels (zoomed in past them all, none does). */
  sharp(file: MediaFile, need: number): boolean {
    return sizesOf(file).some((s) => s >= need * SLACK && !!this.made.get(copyKey(file, s)))
  }

  /**
   * A copy didn't load (gone from disk, say): it's looked for again, and made again if it's gone.
   * One that keeps failing is given up on, so the original plays instead.
   */
  lost(file: MediaFile, url: string): void {
    for (const s of sizesOf(file)) {
      const key = copyKey(file, s)
      const path = this.made.get(key)
      if (!path || mediaUrl(path) !== url) continue
      const n = (this.losses.get(key) ?? 0) + 1
      this.losses.set(key, n)
      if (n > 2) this.made.set(key, null)
      else {
        this.made.delete(key)
        this.checked.delete(fileKey(file))
        this.check([file])
      }
    }
  }

  /**
   * While something plays or is scrubbed, copies are made only for what's on screen (the rest would
   * compete with it for the machine), and one being made for anything else stops until it's done.
   * Returns a function to call when it stops.
   */
  busy(): () => void {
    this.playing++
    clearTimeout(this.settle)
    this.settling = true
    this.preempt()
    let done = false
    return () => {
      if (done) return
      done = true
      this.playing--
      clearTimeout(this.settle)
      this.settle = setTimeout(() => {
        this.settling = false
        this.next()
      }, IDLE)
    }
  }

  /** Whether a copy may be made now. */
  private allowed(job: Job): boolean {
    return (!this.playing && !this.settling) || job.priority === NOW
  }

  /**
   * What's happening to a file's first copy (the one that makes it play smoothly): being made (and
   * how far along), waiting, or nothing (made, or not wanted). Sharper copies aren't counted: by
   * then it plays smoothly already.
   */
  state(file: Pick<MediaFile, 'path' | 'mtime'>): CopyState {
    const fk = fileKey(file)
    const cur = this.current
    if (cur && fileKey(cur.job.file) === fk && this.first(cur.job)) return { state: 'making', progress: cur.progress }
    return this.waiting.has(fk) ? { state: 'queued' } : null
  }

  /**
   * Overall: videos made smooth, of how many need it (the one in progress counted with its
   * progress); or, with all of them done, a sharper copy being made; null with nothing to do.
   */
  get activity(): { label: string; done: number; total: number; progress: number } | null {
    const cur = this.current
    const files = new Set(this.waiting)
    if (cur && this.first(cur.job)) files.add(fileKey(cur.job.file))
    if (files.size) {
      const done = [...this.finished].filter((f) => !files.has(f)).length
      return { label: 'Preparing videos', done, total: done + files.size, progress: cur && this.first(cur.job) ? cur.progress : 0 }
    }
    return cur ? { label: 'Sharpening for full view', done: 0, total: 1, progress: cur.progress } : null
  }

  /** It's a file's smallest copy: the one that makes it play smoothly. */
  private first(job: Job): boolean {
    return job.size === sizesOf(job.file)[0]
  }

  /** Everything still to make, most urgent first (a copy wanted in several ways at its most urgent). */
  private todo = $derived.by((): Job[] => {
    const best = new Map<string, Job>()
    const consider = (j: Job) => {
      const fk = fileKey(j.file)
      if (this.made.has(j.key) || !this.checked.has(fk) || this.checking.has(fk)) return
      const have = best.get(j.key)
      if (!have || j.priority < have.priority) best.set(j.key, j)
    }
    for (const { job } of this.wanted.values()) consider(job)
    this.ahead.forEach((file, i) => {
      const size = sizesOf(file)[0]
      consider({ key: copyKey(file, size), file, size, priority: LATER, since: i })
    })
    return [...best.values()].sort((a, b) => a.priority - b.priority || a.size - b.size || a.since - b.since)
  })
  /** Files with first copies still to make. */
  private waiting = $derived(new Set(this.todo.filter((j) => this.first(j)).map((j) => fileKey(j.file))))

  private queue(): Job[] {
    return this.todo
  }

  /** How urgent a copy is now (it may have stopped being wanted since it was started). */
  private urgency(key: string): number {
    const q = this.queue().find((j) => j.key === key)
    return q?.priority ?? LATER + 1
  }

  /** The next copy to make, if any may be made now. */
  private pick(): Job | undefined {
    return this.queue().find((j) => this.allowed(j))
  }

  /** Looks up which copies of these files are made already, in one go. */
  private check(files: MediaFile[]) {
    const fresh = files.filter((f) => !this.checked.has(fileKey(f)))
    if (!fresh.length) return void this.next()
    for (const f of fresh) {
      this.checked.add(fileKey(f))
      this.checking.add(fileKey(f))
    }
    this.toCheck.push(...fresh)
    queueMicrotask(async () => {
      const batch = this.toCheck.splice(0)
      if (!batch.length) return
      const list = batch.flatMap((f) => sizesOf(f).map((edge) => ({ f, edge })))
      const found = await api.copiesMade(list.map(({ f, edge }) => ({ path: f.path, edge }))).catch(() => list.map(() => null))
      list.forEach(({ f, edge }, i) => {
        const p = found[i]
        if (p) this.made.set(copyKey(f, edge), p)
      })
      for (const f of batch) this.checking.delete(fileKey(f))
      this.next()
    })
  }

  /**
   * Stops the copy being made if something waiting is more urgent, or if it mayn't be made while
   * something plays.
   */
  private preempt() {
    const cur = this.current
    if (!cur || this.stopping === cur.id) return
    const now = { ...cur.job, priority: this.urgency(cur.job.key) }
    const top = this.pick()
    if (!this.allowed(now) || (top && top.key !== cur.job.key && top.priority < now.priority)) {
      this.stopping = cur.id
      api.cancelCopy()
    }
  }

  private async next() {
    if (this.running) return this.preempt()
    this.running = true
    for (;;) {
      const job = this.pick()
      if (!job) break
      const id = ++this.ids
      this.current = { id, job, progress: 0 }
      try {
        const path = await api.copy(id, job.file.path, job.file.w, job.file.h, job.file.color, job.size, job.file.duration, job.priority === LATER)
        // Null: stopped for something more urgent (or while something plays); it waits its turn again.
        if (!path) continue
        this.made.set(job.key, path)
        if (this.first(job)) this.finished.add(fileKey(job.file))
      } catch {
        // It can't be made: the original stands in.
        this.made.set(job.key, null)
      }
    }
    this.current = null
    this.running = false
    // Held back (something's playing), not done: progress so far still counts.
    if (!this.queue().length) this.finished.clear()
  }
}

export const copies = new Copies()
