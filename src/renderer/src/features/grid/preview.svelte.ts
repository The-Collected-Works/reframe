import { untrack } from 'svelte'
import { cubicOut } from 'svelte/easing'
import { Tween } from 'svelte/motion'
import type { Track } from '../../lib/playback/playback'
import { Player } from '../../state/playback.svelte'
import { scroll } from './context'

const SCROLL_SETTLE = 250
const DWELL = 150

/** What a thumbnail plays: its tracks, looping round `length` seconds. */
export interface Playable {
  tracks: Track[]
  length: number
  /** Play a file itself while its copy is being made (one video, yes; a composition's several, no). */
  originals: boolean
}

/**
 * A thumbnail playing in place while hovered, through the playback engine: a video (its trim,
 * looping) or a composition (each of its videos in its cell). Copies come in the smallest size, or
 * as they're made. A hover becomes a preview only once the pointer has rested on it and the grid
 * has stopped scrolling (thumbnails sliding under a still pointer mid-scroll shouldn't each start
 * playing). It starts on the frame the thumbnail shows and fades in only once it has a frame of its
 * own, so there's no jump or blank flash either way; leaving holds the last frame and fades back.
 * Create it while a component initialises.
 */
export class HoverPreview {
  hovering = $state(false)
  /** Drawn over the thumbnail at this opacity. */
  readonly fade = new Tween(0, { duration: 180, easing: cubicOut })
  private ready = $state(false)
  /** The preview on screen (also while fading out), and one starting that has no frame yet. */
  private shown = $state.raw<Player | null>(null)
  private incoming = $state.raw<Player | null>(null)
  private held = false

  /** `enabled`: the grid is showing and the eyedropper isn't (it needs the exact thumbnail). */
  constructor(playable: () => Playable | null, enabled: () => boolean, redraw: () => void) {
    $effect(() => {
      if (!this.hovering) return void (this.ready = false)
      const since = performance.now()
      let t: ReturnType<typeof setTimeout> | undefined
      const check = () => {
        const now = performance.now()
        const wait = Math.max(since + DWELL - now, scroll.last + SCROLL_SETTLE - now)
        if (wait > 0) t = setTimeout(check, wait)
        else this.ready = true
      }
      check()
      return () => clearTimeout(t)
    })

    // The clock moving, each new frame and each step of the fade redraw the thumbnail.
    $effect(() => {
      void this.fade.current
      const p = this.shown
      if (!p) return
      void p.version
      void p.time
      untrack(redraw)
    })

    // A preview takes over once it has a frame (from one still fading out, at its opacity).
    $effect(() => {
      const p = this.incoming
      if (!p) return
      void p.version
      if (!untrack(playable)?.tracks.some((t) => p.frame(t.id))) return
      untrack(() => {
        if (this.shown && this.shown !== p) this.shown.destroy()
        this.shown = p
        this.incoming = null
        if (this.held) p.pause()
        this.fade.target = 1
      })
    })

    // Whether there's anything to play (what, changing with every edit, goes to the player as it is).
    const something = $derived(!!playable()?.tracks.length)
    $effect(() => {
      if (!this.ready || !enabled() || !something) return
      const p = untrack(
        () =>
          new Player({
            tracks: () => playable()?.tracks ?? [],
            range: () => ({ start: 0, end: playable()?.length ?? 0 }),
            originals: untrack(playable)?.originals ?? false,
            autoplay: true
          })
      )
      this.incoming = p
      return () => {
        if (this.incoming === p) {
          this.incoming = null
          return p.destroy()
        }
        p.pause()
        this.fade.set(0).then(() => {
          if (this.shown !== p) return
          this.shown = null
          p.destroy()
        })
      }
    })
  }

  /** Whether a preview is showing (also while it fades out): draw `frame`s over the thumbnail at `fade`. */
  get showing(): boolean {
    return !!this.shown
  }

  /** What to draw for track `id` now, if it has anything. */
  frame(id: string): CanvasImageSource | null {
    return this.shown?.frame(id) ?? null
  }

  /**
   * While the thumbnail is dragged, the preview holds still on its frame: playing, it would redraw
   * the cell every frame on top of the drag's own redraws. It plays on when let go.
   */
  hold(on: boolean): void {
    this.held = on
    const p = this.shown
    if (!p || !this.ready) return
    if (on) p.pause()
    else p.play()
  }
}
