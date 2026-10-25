import { untrack } from 'svelte'
import { cubicOut } from 'svelte/easing'
import { Tween } from 'svelte/motion'
import { posterTime } from '@shared/media'
import type { Clip } from '@shared/types'
import { mediaUrl } from '../../lib/bridge'
import type { Asset } from '../../state/app.svelte'
import { scroll } from './shared'

const SCROLL_SETTLE = 250
const DWELL = 150

const release = (v: HTMLVideoElement) => {
  v.pause()
  v.removeAttribute('src')
  v.load()
}

/**
 * A video thumbnail playing in place while hovered. A hover becomes a preview only once the pointer
 * has rested on it and the grid has stopped scrolling (thumbnails sliding under a still pointer
 * mid-scroll shouldn't each start loading a video). It starts on the thumbnail's own frame and fades
 * in only once the video has presented one, so there's no jump or blank flash either way; leaving
 * holds the last frame and fades back. Create it while a component initialises.
 */
export class HoverPreview {
  hovering = $state(false)
  /** The playing video (also while fading out), drawn over the thumbnail at `fade`. */
  video: HTMLVideoElement | null = null
  readonly fade = new Tween(0, { duration: 180, easing: cubicOut })
  #ready = $state(false)

  /** `enabled`: the grid is showing and the eyedropper isn't (it needs the exact thumbnail). */
  constructor(asset: () => Asset, clip: () => Clip | undefined, enabled: () => boolean, redraw: () => void) {
    $effect(() => {
      if (!this.hovering) return void (this.#ready = false)
      const since = performance.now()
      let t: ReturnType<typeof setTimeout> | undefined
      const check = () => {
        const now = performance.now()
        const wait = Math.max(since + DWELL - now, scroll.last + SCROLL_SETTLE - now)
        if (wait > 0) t = setTimeout(check, wait)
        else this.#ready = true
      }
      check()
      return () => clearTimeout(t)
    })

    $effect(() => {
      void this.fade.current
      if (this.video) untrack(redraw)
    })

    $effect(() => {
      const a = asset()
      if (!this.#ready || !enabled() || a.kind !== 'video' || !a.w) return
      const v = document.createElement('video')
      v.crossOrigin = 'anonymous'
      v.muted = true
      v.playsInline = true
      v.preload = 'auto'
      v.src = mediaUrl(a.path)
      const start = clip()?.start ?? 0
      const end = clip()?.end ?? a.duration
      v.currentTime = Math.min(Math.max(posterTime(a.duration), start), Math.max(start, end - 0.1))
      let alive = true
      // A frame on every presented video frame, looping within the trim.
      const onFrame = () => {
        if (!alive) return
        if (v.currentTime >= end - 0.03) v.currentTime = start
        if (this.video === v) redraw()
        v.requestVideoFrameCallback(onFrame)
      }
      const first = () => {
        if (!alive) return
        // A previous hover may still be fading out; this one takes over from its current opacity.
        if (this.video && this.video !== v) release(this.video)
        this.video = v
        this.fade.target = 1
        onFrame()
      }
      v.play()
        .then(() => v.requestVideoFrameCallback(first))
        .catch(() => {})
      return () => {
        alive = false
        if (this.video !== v) return release(v)
        v.pause()
        this.fade.set(0).then(() => {
          if (this.video === v) this.video = null
          release(v)
        })
      }
    })
  }
}
