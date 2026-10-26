/** What copies are made as (H.264 High, level 4.2: fixed by the media worker so it's known here). */
const TYPE = 'video/mp4; codecs="avc1.64002A"'

/** Whether copies can be played while they're made. */
export const canStream = (): boolean => typeof MediaSource !== 'undefined' && MediaSource.isTypeSupported(TYPE)

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** What a StreamFeed reads with and plays into: the browser's own, or fakes in tests. */
export interface StreamEnv {
  fetch: (url: string, init: RequestInit) => Promise<Response>
  mediaSource: () => MediaSource
  objectUrl: (ms: MediaSource) => string
  revoke: (url: string) => void
}

const browser = (): StreamEnv => ({
  fetch: (url, init) => fetch(url, init),
  mediaSource: () => new MediaSource(),
  objectUrl: (ms) => URL.createObjectURL(ms),
  revoke: (url) => URL.revokeObjectURL(url)
})
const ended = (sb: SourceBuffer) => new Promise((r) => sb.addEventListener('updateend', r, { once: true }))

/**
 * Plays a copy that's still being made. The media worker writes it as a fragmented MP4, a quarter
 * second a fragment; this reads the file as it grows and feeds what's new to a MediaSource, so the
 * start plays while the rest is encoded (faster than it plays). Ahead of what's arrived, the video
 * waits, as it would for a slow download. Call `stop()` when done.
 */
export class StreamFeed {
  /** For the video's `src`. */
  readonly url: string
  private ms: MediaSource
  private sb: SourceBuffer | null = null
  private offset = 0
  private stopped = false

  /** `src`: the stream's file; `video`: what plays it (to make room behind its playhead). */
  constructor(
    private src: string,
    duration: number,
    private video: () => HTMLVideoElement | null,
    private env: StreamEnv = browser()
  ) {
    this.ms = env.mediaSource()
    this.url = env.objectUrl(this.ms)
    this.ms.addEventListener(
      'sourceopen',
      () => {
        if (this.stopped) return
        // The whole length from the start, so its timeline (and seeking) is the copy's.
        this.ms.duration = duration
        this.sb = this.ms.addSourceBuffer(TYPE)
        this.pump()
      },
      { once: true }
    )
  }

  stop(): void {
    this.stopped = true
    this.env.revoke(this.url)
  }

  /**
   * Reads what's been written since last time, until stopped (the clip moves on once the copy's
   * done, or if it's given up on). Not there yet, or a read cut short: it tries again shortly.
   */
  private async pump() {
    while (!this.stopped) {
      let data: ArrayBuffer | null = null
      try {
        const res = await this.env.fetch(this.src, { headers: { Range: `bytes=${this.offset}-` } })
        // 416: nothing new yet; 404: not started yet.
        if (res.ok) data = await res.arrayBuffer()
      } catch {
        // Read while it was being written: again next time.
      }
      if (this.stopped) return
      if (data?.byteLength) {
        this.offset += data.byteLength
        if (!(await this.append(data))) return
        continue
      }
      await sleep(120)
    }
  }

  /**
   * Adds bytes (whole fragments or not: the parser waits for the rest). When the buffer's full (a
   * long video), what's well behind the playhead goes; until then it waits for playback to move on.
   */
  private async append(data: ArrayBuffer): Promise<boolean> {
    for (;;) {
      const sb = this.sb
      if (!sb || this.stopped) return false
      try {
        sb.appendBuffer(data)
        await ended(sb)
        return true
      } catch (e) {
        if ((e as DOMException).name !== 'QuotaExceededError') return false
        const t = this.video()?.currentTime ?? 0
        if (t > 15 && sb.buffered.length && sb.buffered.start(0) < t - 10) {
          sb.remove(0, t - 10)
          await ended(sb)
        } else await sleep(500)
      }
    }
  }
}
