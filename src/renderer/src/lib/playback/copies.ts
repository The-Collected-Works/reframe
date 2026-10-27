import type { ColorMeta } from '@shared/types'
import { BatchedEmitter, Emitter } from './emitter'
import type { MediaHost } from './host'

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
export const IDLE = 2000

/** The copy sizes a file can have, smallest first. */
export const sizesOf = (f: MediaFile): number[] => [...new Set(SIZES.map((s) => Math.min(s, Math.max(f.w, f.h))))]

/** The size to show `f` at when it covers `need` device pixels: the smallest that's sharp enough. */
export function sizeFor(f: MediaFile, need: number): number {
  const sizes = sizesOf(f)
  return sizes.find((s) => s >= need * SLACK) ?? sizes[sizes.length - 1]
}

export const fileKey = (f: Pick<MediaFile, 'path' | 'mtime'>): string => `${f.path}|${f.mtime}`
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

/** Overall progress, for the title bar. */
export interface CopyActivity {
  label: string
  done: number
  total: number
  progress: number
}

/**
 * The playback copies of video files: small, every frame a keyframe, so they play several at once
 * and seek instantly where originals (4K, 60fps, keyframes seconds apart) can't. Made by the media
 * worker a few at a time (`slots`, from how many cores the machine has), most urgent first: what's on screen now, then what's likely next, then
 * every other video in the folder, ahead of time, at low priority. Within each, smaller sizes first
 * (something playable soonest), then in the order asked. When something more urgent comes up while
 * every slot is making something less urgent, the least urgent of those stops and waits its turn
 * again, so what you're looking at never waits behind anything. Copies are kept between sessions: opening a folder first asks
 * which are made already.
 *
 * Plain TypeScript: told what's wanted through its methods, it says when anything changed through
 * `changed` (what's made, wanted, streaming or failed) and `progressed` (the copy being made moved
 * on), kept apart so what plays isn't disturbed by every step of progress.
 */
export class Copies {
  /** What's made, wanted, streaming or failed changed (once per burst, on the next microtask). */
  readonly changed = new BatchedEmitter()
  /** The copy being made moved on. */
  readonly progressed = new Emitter()

  /** By file and size: the copy's path, or null (none could be made). */
  private made = new Map<string, string | null>()
  /** Files whose made copies have been looked up, and those being looked up. */
  private checked = new Set<string>()
  private checking = new Set<string>()
  private toCheck: MediaFile[] = []
  /** Asked for by what's showing (on screen now, or likely next), with how many ask. */
  private wanted = new Map<string, { job: Job; refs: number }>()
  /** Every video in the folder, made ahead of time at the smallest size. */
  private ahead: MediaFile[] = []
  /** The copies being made, by id: how far along, and (a first copy) the stream it plays from meanwhile. */
  private running = new Map<number, { id: number; job: Job; progress: number; stream?: string }>()
  /** Those streams on their own, by file: each changes only when a stream starts or ends. */
  private live = new Map<string, string>()
  /** Copies being stopped (their slots free once they have). */
  private stopping = new Set<number>()
  private ids = 0
  private asked = 0
  /** How many copies are made at once. */
  private slots: number
  /** Copies made since there was last nothing to do, for overall progress. */
  private finished = new Set<string>()
  /** Something is playing or being scrubbed: only what's on screen is made meanwhile. */
  private playing = 0
  /** And for a moment after (pausing, stepping to another video), so it isn't started only to be stopped. */
  private settling = false
  private settle: ReturnType<typeof setTimeout> | undefined
  /** Copies that failed to load, by file and size, and how often. */
  private losses = new Map<string, number>()
  /** `todo` and `waiting`, worked out once per change (the UI asks for every thumbnail). */
  private cache: { todo: Job[]; waiting: Set<string> } | null = null
  private unlisten: () => void

  constructor(
    private host: MediaHost,
    opts: { slots?: number } = {}
  ) {
    this.slots = Math.max(1, opts.slots ?? 1)
    this.unlisten = host.onCopyProgress(({ id, progress, stream }) => {
      const cur = this.running.get(id)
      if (!cur) return
      this.running.set(id, { ...cur, progress, stream: stream ?? cur.stream })
      const fk = fileKey(cur.job.file)
      if (stream && this.live.get(fk) !== host.url(stream)) {
        this.live.set(fk, host.url(stream))
        this.touch()
      }
      this.progressed.emit()
    })
  }

  destroy(): void {
    this.unlisten()
    clearTimeout(this.settle)
  }

  /** Something that decides what's made, or what's shown, changed. */
  private touch() {
    this.cache = null
    this.changed.emit()
  }

  /**
   * Asks for `file` at `size` (and at its smallest size first, if that's not it), as soon as
   * `priority` says. Returns a function that withdraws the request.
   */
  want(file: MediaFile, size: number, priority = NOW): () => void {
    const smallest = sizesOf(file)[0]
    const sizes = [...new Set([smallest, size])]
    const keys = sizes.map((s) => `${copyKey(file, s)}#${priority}`)
    sizes.forEach((s, i) => {
      const w = this.wanted.get(keys[i])
      if (w) w.refs++
      else
        this.wanted.set(keys[i], {
          job: { key: copyKey(file, s), file, size: s, priority: s === smallest ? priority : priority + SHARPER, since: ++this.asked },
          refs: 1
        })
    })
    this.touch()
    this.check([file])
    this.next()
    let withdrawn = false
    return () => {
      if (withdrawn) return
      withdrawn = true
      for (const k of keys) {
        const w = this.wanted.get(k)
        if (!w) continue
        if (w.refs <= 1) this.wanted.delete(k)
        else w.refs--
      }
      this.touch()
      // What's being made may now matter less than what's waiting.
      this.preempt()
    }
  }

  /**
   * The caches were emptied: everything made is forgotten (and looked for again), so it's made
   * again as it's needed. What's playing moves to its original or a stream meanwhile.
   */
  reset(): void {
    this.made.clear()
    this.checked.clear()
    this.checking.clear()
    this.losses.clear()
    this.finished.clear()
    this.touch()
    this.check([...this.ahead, ...[...this.wanted.values()].map((w) => w.job.file)])
  }

  /** Every video in the folder: each gets its smallest copy ahead of time. */
  prepare(files: MediaFile[]): void {
    this.ahead = files
    this.touch()
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
      if (path) return { url: this.host.url(path), size: s }
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

  /**
   * A first copy still being made, to play as it's written: its stream, and how many seconds of it
   * are encoded so far. Null when there's none.
   */
  streaming(file: MediaFile): { url: string; ready: number } | null {
    const cur = this.firstMaking(fileKey(file))
    if (!cur?.stream) return null
    return { url: this.host.url(cur.stream), ready: cur.progress * file.duration }
  }

  /** The address of a first copy's stream while it's being made (see `streaming`), and nothing else. */
  streamUrl(file: MediaFile): string | null {
    return this.live.get(fileKey(file)) ?? null
  }

  /** The copy being made of a file's first (smallest) size, if one is. */
  private firstMaking(fk: string) {
    for (const r of this.running.values()) if (fileKey(r.job.file) === fk && this.first(r.job)) return r
    return undefined
  }

  /**
   * How much of `file` plays smoothly (seconds from its start): all of it once a copy's made, as far
   * as it's encoded while one streams, else none.
   */
  ready(file: MediaFile): number {
    if (this.best(file, 0)) return file.duration
    return this.streaming(file)?.ready ?? 0
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
      if (!path || this.host.url(path) !== url) continue
      const n = (this.losses.get(key) ?? 0) + 1
      this.losses.set(key, n)
      if (n > 2) this.made.set(key, null)
      else {
        this.made.delete(key)
        this.checked.delete(fileKey(file))
        this.check([file])
      }
      this.touch()
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
    const cur = this.firstMaking(fk)
    if (cur) return { state: 'making', progress: cur.progress }
    return this.plan().waiting.has(fk) ? { state: 'queued' } : null
  }

  /**
   * Overall: videos made smooth, of how many need it (those in progress counted with their
   * progress); or, with all of them done, sharper copies being made; null with nothing to do.
   */
  activity(): CopyActivity | null {
    const firsts = [...this.running.values()].filter((r) => this.first(r.job))
    const files = new Set(this.plan().waiting)
    for (const r of firsts) files.add(fileKey(r.job.file))
    if (files.size) {
      const done = [...this.finished].filter((f) => !files.has(f)).length
      return { label: 'Preparing videos', done, total: done + files.size, progress: firsts.reduce((n, r) => n + r.progress, 0) }
    }
    const sharper = [...this.running.values()]
    if (!sharper.length) return null
    return { label: 'Sharpening for full view', done: 0, total: sharper.length, progress: sharper.reduce((n, r) => n + r.progress, 0) }
  }

  /** It's a file's smallest copy: the one that makes it play smoothly. */
  private first(job: Job): boolean {
    return job.size === sizesOf(job.file)[0]
  }

  /**
   * Everything still to make, most urgent first (a copy wanted in several ways at its most urgent),
   * and the files with first copies among it.
   */
  private plan(): { todo: Job[]; waiting: Set<string> } {
    if (this.cache) return this.cache
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
    const todo = [...best.values()].sort((a, b) => a.priority - b.priority || a.size - b.size || a.since - b.since)
    return (this.cache = { todo, waiting: new Set(todo.filter((j) => this.first(j)).map((j) => fileKey(j.file))) })
  }

  /** How urgent a copy is now (it may have stopped being wanted since it was started). */
  private urgency(key: string): number {
    return this.plan().todo.find((j) => j.key === key)?.priority ?? LATER + 1
  }

  /** The next copy to make, if any may be made now (and isn't being made already). */
  private pick(): Job | undefined {
    const making = new Set([...this.running.values()].map((r) => r.job.key))
    return this.plan().todo.find((j) => this.allowed(j) && !making.has(j.key))
  }

  /** Looks up which copies of these files are made already, in one go. */
  private check(files: MediaFile[]) {
    const fresh = files.filter((f) => !this.checked.has(fileKey(f)))
    if (!fresh.length) return void this.next()
    for (const f of fresh) {
      this.checked.add(fileKey(f))
      this.checking.add(fileKey(f))
    }
    this.touch()
    this.toCheck.push(...fresh)
    queueMicrotask(async () => {
      const batch = this.toCheck.splice(0)
      if (!batch.length) return
      const list = batch.flatMap((f) => sizesOf(f).map((edge) => ({ f, edge })))
      const found = await this.host.copiesMade(list.map(({ f, edge }) => ({ path: f.path, edge }))).catch(() => list.map(() => null))
      list.forEach(({ f, edge }, i) => {
        const p = found[i]
        if (p) this.made.set(copyKey(f, edge), p)
      })
      for (const f of batch) this.checking.delete(fileKey(f))
      this.touch()
      this.next()
    })
  }

  /**
   * Stops copies that mayn't be made while something plays; and with every slot taken, the least
   * urgent copy being made if something waiting is more urgent.
   */
  private preempt() {
    const live = [...this.running.values()].filter((r) => !this.stopping.has(r.id))
    const urgency = new Map(live.map((r) => [r.id, this.urgency(r.job.key)]))
    for (const r of live) if (!this.allowed({ ...r.job, priority: urgency.get(r.id)! })) this.stop(r.id)
    if (this.running.size < this.slots) return
    const top = this.pick()
    const least = live.filter((r) => !this.stopping.has(r.id)).sort((a, b) => urgency.get(b.id)! - urgency.get(a.id)!)[0]
    if (top && least && top.priority < urgency.get(least.id)!) this.stop(least.id)
  }

  private stop(id: number) {
    this.stopping.add(id)
    this.host.cancelCopy(id)
  }

  /** Starts copies until every slot is busy (or nothing more may be made now). */
  private next() {
    this.preempt()
    while (this.running.size < this.slots) {
      const job = this.pick()
      if (!job) break
      this.start(job)
    }
  }

  private start(job: Job) {
    const id = ++this.ids
    const fk = fileKey(job.file)
    this.running.set(id, { id, job, progress: 0 })
    this.touch()
    // A first copy streams while it's made: what's been encoded plays at once (see StreamFeed).
    this.host
      .copy(
        id,
        job.file.path,
        job.file.w,
        job.file.h,
        job.file.color,
        job.size,
        job.file.duration,
        job.priority === LATER,
        this.first(job) && this.host.streams
      )
      .then((path) => {
        // Null: stopped for something more urgent (or while something plays); it waits its turn again.
        if (!path) return
        this.made.set(job.key, path)
        if (this.first(job)) this.finished.add(fk)
      })
      // It can't be made: the original stands in.
      .catch(() => void this.made.set(job.key, null))
      .finally(() => {
        this.running.delete(id)
        this.stopping.delete(id)
        if (this.first(job)) this.live.delete(fk)
        this.touch()
        this.next()
        // Held back (something's playing), not done: progress so far still counts.
        if (!this.running.size && !this.plan().todo.length) this.finished.clear()
      })
  }
}
