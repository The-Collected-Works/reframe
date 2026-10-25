import { untrack } from 'svelte'
import { drawFrame } from '@shared/layout'
import type { Artboard, CropSettings } from '@shared/types'
import { api, mediaUrl } from '../../lib/bridge'
import { releaseVideo, silentVideo } from '../../lib/media'
import type { Asset } from '../../state/library.svelte'
import { showToast } from '../../ui'

export interface PlayerOptions {
  /** The video (the same file for the player's life; its details can still arrive). */
  asset: () => Asset
  /** The kept range, which playback loops within. */
  clip: () => { start: number; end: number }
  /** Silent (exported muted); otherwise at `volume`. */
  muted: () => boolean
  volume: () => number
  /** The eyedropper is open: it samples the screen, so playback pauses on the exact frame. */
  picking: () => boolean
  /** How trim previews frame the video. */
  board: () => Artboard
  settings: () => CropSettings
}

/**
 * Playing one video in the single view: the video itself, the scrub proxy that stands in while the
 * playhead is dragged, ffmpeg's exact frame while paused, and a second video for trim previews.
 * `frame` changes whenever there's something new to draw; `source()` says what. Call `destroy()`
 * when done (the view makes one per file).
 */
export class Player {
  /** The video, once it has a frame to show; null while loading, or if it can't play here. */
  video = $state.raw<HTMLVideoElement | null>(null)
  playing = $state(false)
  /** Play pressed before the video has loaded (slow drives, network paths, big files): it starts
      as soon as a frame is ready, so Play is never disabled. */
  queued = $state(false)
  /** The browser can't decode it (ProRes, or HEVC without the platform's decoder): the poster
      and the scrub proxy (made by ffmpeg) stand in, and export still works. */
  unplayable = $state(false)
  time = $state(0)
  /** While the playhead is dragged: where the pointer has it, shown at once whatever the decoder is doing. */
  scrubTime = $state<number | null>(null)
  /** The paused frame decoded by ffmpeg, as export will see it. Chromium's own decode can be off by
      several levels (badly so for full-range video), which would make colour matching misleading. */
  exact = $state.raw<{ t: number; jpeg: Blob } | null>(null)
  /** Bumped whenever a new frame is ready to draw. */
  frame = $state(0)

  private opts: PlayerOptions
  private el: HTMLVideoElement
  /** Low-res, all-keyframe copy for scrubbing; drawn in place of the video while scrubbing. */
  private proxy = $state.raw<HTMLVideoElement | null>(null)
  private scrubSrc: HTMLVideoElement | null = null
  private scrubbing: { resume: boolean } | null = null
  /** At most one seek in flight; while it runs only the newest target is kept. Issuing a seek per
      pointer move makes the browser abandon most of them and the frame stutters. */
  private pendingSeek: number | null = null
  private proxyPending: number | null = null
  private previews: { v: HTMLVideoElement; pending: number | null; canvas: HTMLCanvasElement | null } | null = null
  private stop: () => void

  constructor(opts: PlayerOptions) {
    this.opts = opts
    const { path } = untrack(opts.asset)
    const v = document.createElement('video')
    v.crossOrigin = 'anonymous'
    v.playsInline = true
    v.preload = 'auto'
    // Loops natively when untrimmed; the playback loop below handles trimmed ranges.
    v.loop = true
    v.src = mediaUrl(path)
    this.el = v
    const fail = () => {
      releaseVideo(v)
      this.unplayable = true
    }
    v.addEventListener('error', fail, { once: true })
    v.addEventListener(
      'loadeddata',
      () => {
        // Audio but no picture: the video track's codec isn't supported.
        if (!v.videoWidth) return fail()
        v.currentTime = untrack(opts.clip).start
        this.video = v
      },
      { once: true }
    )
    this.stop = $effect.root(() => this.effects())
  }

  destroy(): void {
    this.stop()
    releaseVideo(this.el)
    if (this.previews) releaseVideo(this.previews.v)
  }

  private effects() {
    // Scrub proxy: requested once a video has been open for a moment (not for every one flicked
    // past), built in the background, then loaded into a hidden muted video ready for seeking.
    $effect(() => {
      const { path, w, h, color } = this.opts.asset()
      if (!w) return
      let alive = true
      let pv: HTMLVideoElement | null = null
      const timer = setTimeout(() => {
        api
          .scrubProxy(path, w, h, color)
          .then((proxyPath) => {
            if (!alive) return
            const v = (pv = silentVideo(mediaUrl(proxyPath)))
            v.addEventListener('loadeddata', () => alive && (this.proxy = v), { once: true })
            v.addEventListener('seeked', () => {
              if (this.scrubSrc === v) this.frame++
              if (this.proxyPending != null) {
                v.currentTime = this.proxyPending
                this.proxyPending = null
              }
            })
          })
          .catch(() => {})
      }, 500)
      return () => {
        alive = false
        clearTimeout(timer)
        if (pv) releaseVideo(pv)
      }
    })

    // Preview audio: silent if the export is muted; otherwise the global preview volume.
    $effect(() => {
      if (!this.video) return
      const volume = this.opts.volume()
      this.video.volume = volume
      this.video.muted = this.opts.muted() || volume === 0
    })

    // The eyedropper samples the screen; pause so it sees the exact frame, not the browser's decode.
    $effect(() => {
      if (this.opts.picking() && this.video && !this.video.paused) this.video.pause()
    })

    // Pressed before the video loaded: play now (or say why it can't).
    $effect(() => {
      if (!this.queued || (!this.video && !this.unplayable)) return
      this.queued = false
      untrack(() => this.toggle())
    })

    // While paused, swap in the exact frame shortly after each seek.
    $effect(() => {
      const v = this.video
      if (!v || this.playing) return
      const { path, color } = untrack(this.opts.asset)
      let alive = true
      let timer: ReturnType<typeof setTimeout> | undefined
      const request = () => {
        clearTimeout(timer)
        const t = v.currentTime
        timer = setTimeout(async () => {
          try {
            const data = await api.frame(path, t, color)
            if (alive && v.paused && Math.abs(v.currentTime - t) < 0.001) this.exact = { t, jpeg: new Blob([data as BlobPart], { type: 'image/jpeg' }) }
          } catch {
            // Keep showing the browser's frame.
          }
        }, 120)
      }
      request()
      v.addEventListener('seeked', request)
      return () => {
        alive = false
        clearTimeout(timer)
        v.removeEventListener('seeked', request)
      }
    })

    // Frames while playing, looping within the trim range; each seek's frame as it lands.
    $effect(() => {
      const v = this.video
      if (!v) return
      let raf = 0
      const tick = () => {
        const { start, end } = this.opts.clip()
        if (v.currentTime >= end - 0.01 || v.currentTime < start - 0.05) v.currentTime = start
        this.time = v.currentTime
        this.frame++
        if (!v.paused) raf = requestAnimationFrame(tick)
      }
      const onPlay = () => {
        this.playing = true
        tick()
      }
      const onPause = () => (this.playing = false)
      const onSeeked = () => {
        // Show each frame as it arrives, then chase the newest target if the pointer has moved on.
        if (this.pendingSeek != null) {
          this.frame++
          v.currentTime = this.pendingSeek
          this.pendingSeek = null
          return
        }
        // The real frame has landed: stop standing in with the proxy.
        if (!this.scrubbing) this.scrubSrc = null
        this.time = v.currentTime
        this.frame++
      }
      v.addEventListener('play', onPlay)
      v.addEventListener('pause', onPause)
      v.addEventListener('seeked', onSeeked)
      untrack(() => {
        if (!v.paused) tick()
      })
      return () => {
        cancelAnimationFrame(raf)
        v.removeEventListener('play', onPlay)
        v.removeEventListener('pause', onPause)
        v.removeEventListener('seeked', onSeeked)
      }
    })
  }

  /**
   * What to draw now: the scrub proxy mid-scrub, ffmpeg's exact frame when paused on it, or the
   * video (null: nothing of its own yet, so the still). `hold`: a seek has no frame to give yet, so
   * keep what's on screen (it repaints when the frame lands) rather than flash a stand-in.
   */
  source(exactBitmap: ImageBitmap | null): { source: CanvasImageSource | null; hold: boolean } {
    const v = this.video
    const useExact = !!(this.exact && exactBitmap && v?.paused && Math.abs(this.exact.t - v.currentTime) < 0.001)
    const want = this.scrubSrc ?? (useExact ? null : v)
    const scrub = this.scrubSrc && this.scrubSrc.readyState >= 2 ? this.scrubSrc : null
    return {
      source: scrub ?? (useExact ? exactBitmap : v && v.readyState >= 2 ? v : null),
      hold: !!want && want.seeking && want.readyState < 2
    }
  }

  toggle(): void {
    if (this.unplayable) return showToast('Can’t play this format here yet · scrubbing, trimming and export still work')
    if (!this.video) return void (this.queued = !this.queued)
    if (this.video.paused) this.video.play().catch(() => {})
    else this.video.pause()
  }

  seek(t: number): void {
    const v = this.video
    if (!v) return
    if (v.seeking) this.pendingSeek = t
    else v.currentTime = t
  }

  // Playhead drags. Playback pauses for the drag (and resumes after). With a proxy, every move
  // seeks the proxy (newest target wins) and its frames are drawn; the real video seeks once, to
  // where the drag ends, and takes over when that frame is ready.
  scrubStart(): void {
    this.scrubbing = { resume: !!this.video && !this.video.paused }
    this.video?.pause()
  }

  scrubTo(t: number): void {
    this.scrubTime = t
    const pv = this.proxy
    if (!pv) return this.seek(t)
    this.scrubSrc = pv
    if (pv.seeking) this.proxyPending = t
    else pv.currentTime = t
  }

  scrubEnd(t: number): void {
    const resume = this.scrubbing?.resume
    this.scrubbing = null
    this.scrubTime = null
    this.time = t
    this.seek(t)
    if (resume) this.video?.play().catch(() => {})
  }

  /** Draws the frame at `t` into `canvas`, from a second muted video, so the view never has to seek mid-drag. */
  preview(canvas: HTMLCanvasElement, t: number): void {
    let s = this.previews
    if (!s) {
      const v = silentVideo(this.proxy?.src ?? mediaUrl(this.opts.asset().path))
      const state = { v, pending: null as number | null, canvas: null as HTMLCanvasElement | null }
      const paint = () => {
        const c = state.canvas
        const a = this.opts.asset()
        const b = this.opts.board()
        if (!c || !a.w || v.readyState < 2) return
        drawFrame(c.getContext('2d')!, v, a.w, a.h, b.width, b.height, this.opts.settings(), c.width / b.width)
      }
      const next = () => {
        paint()
        if (state.pending != null) {
          v.currentTime = state.pending
          state.pending = null
        }
      }
      v.addEventListener('seeked', next)
      v.addEventListener('loadeddata', next)
      s = this.previews = state
    }
    s.canvas = canvas
    if (s.v.readyState < 2 || s.v.seeking) s.pending = t
    else s.v.currentTime = t
  }
}
