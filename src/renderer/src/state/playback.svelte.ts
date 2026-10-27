import { untrack } from 'svelte'
import { api, mediaUrl } from '../lib/bridge'
import { Copies, type CopyActivity, type CopyState, type MediaFile } from '../lib/playback/copies'
import type { MediaHost } from '../lib/playback/host'
import { Playback, type Range, type Sound, type Track } from '../lib/playback/playback'
import { canStream } from '../lib/playback/stream'

/**
 * Where the playback engine (lib/playback, plain TypeScript) meets Svelte: the app's one copy store,
 * and players. Reactive inputs reach the engine only through the few effects in `Player`; the
 * engine's change signals come back as reactive state here. Nothing else subscribes to the engine.
 */

const host: MediaHost = {
  url: mediaUrl,
  streams: canStream(),
  copy: (...args) => api.copy(...args),
  copiesMade: (list) => api.copiesMade(list),
  cancelCopy: (id) => api.cancelCopy(id),
  onCopyProgress: (cb) => api.onCopyProgress(cb),
  frame: (path, time, color, tag, edge) => api.frame(path, time, color, tag, edge)
}

// Copies made at once: decoding 4K is the limit, and it takes most of a mid-range machine on its
// own (two on 32 threads, one on 16 or fewer, at most three).
const store = new Copies(host, { slots: Math.min(3, Math.max(1, Math.floor((navigator.hardwareConcurrency || 4) / 12))) })

/**
 * The playback copies, for the UI: each read follows what it depends on (what's made or wanted,
 * and for progress, each step of it), and the requests go straight to the store.
 */
class CopiesView {
  /** Bumped when what's made, wanted, streaming or failed changes. */
  private changes = $state(0)
  /** Bumped as the copy being made moves on. */
  private steps = $state(0)

  constructor() {
    store.changed.on(() => this.changes++)
    store.progressed.on(() => this.steps++)
  }

  /** Being made (and how far), waiting, or nothing: for a thumbnail's ring. */
  state(file: Pick<MediaFile, 'path' | 'mtime'>): CopyState {
    void this.changes
    void this.steps
    return store.state(file)
  }

  /** Seconds of `file` that play smoothly: for the cache line. */
  ready(file: MediaFile): number {
    void this.changes
    void this.steps
    return store.ready(file)
  }

  /** Whether `file` has nothing to show from yet, and one is on its way. */
  pending(file: MediaFile): boolean {
    void this.changes
    return store.pending(file)
  }

  /** The file of the smallest copy made, if any. */
  smallest(file: MediaFile): string | null {
    void this.changes
    return store.smallest(file)
  }

  /** The best copy made to show `file` at `size`, if any. */
  best(file: MediaFile, size: number): { url: string; size: number } | null {
    void this.changes
    return store.best(file, size)
  }

  /** Overall progress, for the title bar. */
  get activity(): CopyActivity | null {
    void this.changes
    void this.steps
    return store.activity()
  }

  want(file: MediaFile, size: number, priority?: number): () => void {
    return store.want(file, size, priority)
  }

  prepare(files: MediaFile[]): void {
    store.prepare(files)
  }

  reset(): void {
    store.reset()
  }
}

export const copies = new CopiesView()

export interface PlayerInputs {
  tracks: () => Track[]
  range: () => Range
  sound?: () => Sound | null
  /** Stop and stay stopped (the eyedropper is reading the screen). */
  hold?: () => boolean
  /** While a track's copy is being made, play its original (see PlaybackOptions). */
  originals?: boolean
  /** Start playing as soon as it has its inputs. */
  autoplay?: boolean
}

/**
 * A Playback for a component: its outputs as reactive state, its inputs followed from `inputs`.
 * Make one in a component's script or effect; call `destroy()` when done.
 */
export class Player {
  playing = $state(false)
  time = $state(0)
  scrubbing = $state(false)
  /** Playing, with a track that has nothing to show yet. */
  waiting = $state(false)
  /** Changes when a track gets a new source or frame to show (a seek landing, a copy arriving). While
      playing, videos move on by themselves: `time` changes every frame. */
  version = $state(0)

  private core: Playback
  private stop: () => void

  constructor(inputs: PlayerInputs) {
    const core = (this.core = new Playback({ copies: store, host, originals: inputs.originals }))
    const mirror = () => {
      this.playing = core.playing
      this.time = core.time
      this.scrubbing = core.scrubbing
      this.waiting = core.waiting
      this.version = core.version
    }
    const off = core.changed.on(mirror)
    this.stop = $effect.root(() => {
      // The one place reactive inputs reach the engine: one effect per input.
      $effect(() => core.setTracks(inputs.tracks()))
      $effect(() => core.setRange(inputs.range()))
      $effect(() => core.setSound(inputs.sound?.() ?? null))
      $effect(() => core.setHold(inputs.hold?.() ?? false))
      // Once, after the inputs above have reached it (effects run in the order they're made).
      $effect(() => {
        if (inputs.autoplay) untrack(() => core.play())
      })
      return off
    })
  }

  /** What to draw for a track now (read `version` and `time` alongside, to redraw when it changes). */
  frame(id: string): CanvasImageSource | null {
    return this.core.frame(id)
  }

  toggle(): void {
    this.core.toggle()
  }

  play(): void {
    this.core.play()
  }

  pause(): void {
    this.core.pause()
  }

  seek(t: number): void {
    this.core.seek(t)
  }

  scrubStart(): void {
    this.core.scrubStart()
  }

  scrubTo(t: number): void {
    this.core.scrubTo(t)
  }

  scrubEnd(t: number): void {
    this.core.scrubEnd(t)
  }

  preview(id: string, t: number, draw: (src: CanvasImageSource) => void): void {
    this.core.preview(id, t, draw)
  }

  private destroyed = false

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.stop()
    this.core.destroy()
  }
}

export { SOON, sizesOf, type CopyState, type MediaFile } from '../lib/playback/copies'
export type { Track } from '../lib/playback/playback'
