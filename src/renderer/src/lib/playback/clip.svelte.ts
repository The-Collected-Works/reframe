import { releaseVideo, silentVideo } from '../media'

/**
 * One video's pictures, from whichever copy (or original) it's given. Seeks keep only the newest
 * target, so scrubbing never builds a backlog. The last frame shown is held while a seek is in
 * flight, so nothing flashes in between. Moving to another source (a sharper copy) happens without
 * a gap: the old one stays on screen until the new one has a frame where it should be. Silent: sound
 * is played apart (see Sound). Call `release()` when done.
 */
export class Clip {
  /** Bumped whenever there's a new frame to draw. */
  version = $state(0)

  private el: HTMLVideoElement | null = null
  private src = ''
  /** A source on its way in, shown once it has the right frame. */
  private incoming: HTMLVideoElement | null = null
  /** Where it should be, and a seek waiting for the one in flight. */
  private target = 0
  private pending: number | null = null
  private playing = false
  private rate = 1
  /** The last frame shown before a seek (or a change of source), for while there's none to show. */
  private held: ImageBitmap | null = null
  private holding = 0

  /** Called for each new frame (trim previews draw from it straight away). */
  onframe: (() => void) | null = null
  /** Called with a source that wouldn't load (so another can be found). */
  onerror: ((url: string) => void) | null = null

  /** Shows `url` from now on (the same one again changes nothing). */
  setSource(url: string): void {
    if (url === this.src) return
    this.src = url
    if (this.incoming) releaseVideo(this.incoming)
    const v = silentVideo(url)
    v.loop = false
    this.incoming = v
    v.addEventListener(
      'error',
      () => {
        if (this.incoming !== v) return
        this.incoming = null
        this.src = this.el?.src ?? ''
        releaseVideo(v)
        this.onerror?.(url)
      },
      { once: true }
    )
    v.addEventListener(
      'loadeddata',
      () => {
        if (this.incoming !== v) return
        // Catch up to where it should be, then take over once that frame is there.
        if (Math.abs(v.currentTime - this.target) > 0.001) v.currentTime = this.target
        else this.takeOver(v)
      },
      { once: true }
    )
    v.addEventListener('seeked', () => this.incoming === v && this.takeOver(v), { once: true })
  }

  private takeOver(v: HTMLVideoElement) {
    if (this.el) {
      this.hold(this.el)
      releaseVideo(this.el)
    }
    this.el = v
    this.incoming = null
    v.playbackRate = this.rate
    v.addEventListener('seeked', () => {
      if (this.el !== v) return
      // Show the frame that landed before chasing a newer target, so scrubbing shows each.
      this.bump()
      if (this.pending != null) {
        const t = this.pending
        this.pending = null
        this.hold(v)
        v.currentTime = t
      }
    })
    if (Math.abs(v.currentTime - this.target) > 0.02) this.seek(this.target)
    if (this.playing) v.play().catch(() => {})
    this.bump()
  }

  private bump() {
    this.version++
    this.onframe?.()
  }

  /**
   * Keeps the frame on screen, to show while there's none: taken just before a seek or a change of
   * source, never per frame. It's asynchronous (the frame is captured as it's asked for), so it
   * never stalls drawing the way copying pixels on the spot would.
   */
  private hold(v: HTMLVideoElement) {
    if (v.readyState < 2 || v.seeking || !v.videoWidth) return
    const n = ++this.holding
    createImageBitmap(v)
      .then((b) => {
        if (n !== this.holding) return b.close()
        this.held?.close()
        this.held = b
      })
      .catch(() => {})
  }

  /** What to draw now: the video's frame, or while it has none (seeking, loading) the last one. */
  frame(): CanvasImageSource | null {
    const v = this.el
    if (v && v.readyState >= 2 && !v.seeking) return v
    return this.held
  }

  /** It has a frame to show (from any source). */
  get ready(): boolean {
    return !!this.held || (!!this.el && this.el.readyState >= 2)
  }

  /** Where it is (or is seeking to). */
  get time(): number {
    return this.pending ?? this.el?.currentTime ?? this.target
  }

  get seeking(): boolean {
    return !!this.el?.seeking
  }

  /** To `t` seconds: straight away, or once the seek in flight lands (newest target wins). */
  seek(t: number): void {
    this.target = t
    const v = this.el
    if (!v) return
    if (v.seeking) this.pending = t
    else if (Math.abs(v.currentTime - t) > 0.001) {
      this.hold(v)
      v.currentTime = t
    }
  }

  play(): void {
    this.playing = true
    if (this.el?.paused) this.el.play().catch(() => {})
  }

  pause(): void {
    this.playing = false
    this.el?.pause()
  }

  /** Playback speed, for closing small drift from the clock without seeking. */
  setRate(rate: number): void {
    this.rate = rate
    if (this.el && this.el.playbackRate !== rate) this.el.playbackRate = rate
  }

  /** Follows the clock while it runs: `t` is where it should be now. */
  follow(t: number, jump: boolean, loopLength: number): void {
    this.target = t
    const v = this.el
    if (!v || v.readyState < 1) return
    const drift = v.currentTime - t
    // Well off (a loop coming round, a jump): seek. A little off: run a touch faster or slower.
    if (jump || Math.abs(drift) > Math.min(0.5, loopLength / 2)) {
      this.setRate(1)
      this.seek(t)
    } else if (!v.seeking) this.setRate(Math.abs(drift) < 0.03 ? 1 : Math.min(1.25, Math.max(0.8, 1 - drift * 2)))
    this.play()
  }

  release(): void {
    this.onframe = null
    this.onerror = null
    if (this.el) releaseVideo(this.el)
    if (this.incoming) releaseVideo(this.incoming)
    this.el = this.incoming = null
    this.held?.close()
    this.held = null
  }
}
