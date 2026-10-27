import { untrack } from 'svelte'
import { cubicOut } from 'svelte/easing'
import { Tween } from 'svelte/motion'
import type { Clip } from '@shared/types'
import type { Asset } from '../../state/library.svelte'
import { Player } from '../../state/playback.svelte'
import { scroll } from './context'

const SCROLL_SETTLE = 250
const DWELL = 150
/** The preview's one track. */
const TRACK = 'hover'

/**
 * A video thumbnail playing in place while hovered, through the playback engine (one track: the
 * video's trim, looping, from its smallest copy, or one being made, or the file meanwhile). A hover
 * becomes a preview only once the pointer has rested on it and the grid has stopped scrolling
 * (thumbnails sliding under a still pointer mid-scroll shouldn't each start a video). It starts on
 * the frame the thumbnail shows and fades in only once it has a frame of its own, so there's no
 * jump or blank flash either way; leaving holds the last frame and fades back. Create it while a
 * component initialises.
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
  constructor(asset: () => Asset, clip: () => Clip | undefined, enabled: () => boolean, redraw: () => void) {
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
      if (!p.frame(TRACK)) return
      untrack(() => {
        if (this.shown && this.shown !== p) this.shown.destroy()
        this.shown = p
        this.incoming = null
        if (this.held) p.pause()
        this.fade.target = 1
      })
    })

    $effect(() => {
      const a = asset()
      if (!this.ready || !enabled() || a.kind !== 'video' || !a.w) return
      const p = untrack(
        () =>
          new Player({
            tracks: () => {
              const c = clip()
              const start = c?.start ?? 0
              const length = Math.max(0.05, (c?.end ?? a.duration) - start)
              return [{ id: TRACK, file: a, start, length, end: 'loop', need: 0 }]
            },
            range: () => {
              const c = clip()
              return { start: 0, end: Math.max(0.05, (c?.end ?? a.duration) - (c?.start ?? 0)) }
            },
            originals: true,
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

  /** What to draw over the thumbnail (at `fade`), if anything. */
  get picture(): CanvasImageSource | null {
    return this.shown?.frame(TRACK) ?? null
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
