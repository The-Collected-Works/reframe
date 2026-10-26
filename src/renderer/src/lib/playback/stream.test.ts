import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StreamFeed, type StreamEnv } from './stream'

/** A SourceBuffer that takes what it's given, or says it's full `full` more times. */
class FakeBuffer {
  appended: number[] = []
  removed: [number, number][] = []
  full = 0
  buffered = { length: 1, start: () => 0, end: () => 60 }
  private waiting: (() => void)[] = []

  addEventListener(_type: string, fn: () => void) {
    this.waiting.push(fn)
  }

  appendBuffer(data: ArrayBuffer) {
    if (this.full > 0) {
      this.full--
      throw new DOMException('The buffer is full', 'QuotaExceededError')
    }
    this.appended.push(data.byteLength)
    queueMicrotask(() => this.updated())
  }

  remove(start: number, end: number) {
    this.removed.push([start, end])
    queueMicrotask(() => this.updated())
  }

  private updated() {
    const fns = this.waiting
    this.waiting = []
    for (const f of fns) f()
  }
}

class FakeSource {
  duration = 0
  buffer = new FakeBuffer()
  addEventListener(_type: string, fn: () => void) {
    queueMicrotask(fn)
  }
  addSourceBuffer() {
    return this.buffer
  }
}

/** Answers reads in turn from `replies` (a status, or that many new bytes), then "nothing new". */
function env(replies: (number | { bytes: number })[]) {
  const source = new FakeSource()
  const ranges: string[] = []
  const e: StreamEnv = {
    fetch: async (_url, init) => {
      ranges.push((init.headers as Record<string, string>).Range)
      const r = replies.shift() ?? 416
      return typeof r === 'number' ? new Response(null, { status: r }) : new Response(new Uint8Array(r.bytes), { status: 206 })
    },
    mediaSource: () => source as unknown as MediaSource,
    objectUrl: () => 'blob:stream',
    revoke: () => {}
  }
  return { env: e, source, ranges }
}

beforeEach(() => void vi.useFakeTimers())
afterEach(() => void vi.useRealTimers())

describe('StreamFeed', () => {
  it('waits for the stream to start, then reads only what is new each time', async () => {
    const { env: e, source, ranges } = env([404, 416, { bytes: 100 }, { bytes: 50 }])
    const feed = new StreamFeed('media:/s/a.mp4', 12, () => null, e)
    await vi.advanceTimersByTimeAsync(1000)
    feed.stop()
    expect(source.duration).toBe(12)
    expect(source.buffer.appended).toEqual([100, 50])
    expect(ranges.slice(0, 5)).toEqual(['bytes=0-', 'bytes=0-', 'bytes=0-', 'bytes=100-', 'bytes=150-'])
  })

  it('makes room well behind the playhead when the buffer is full', async () => {
    const { env: e, source } = env([{ bytes: 100 }])
    source.buffer.full = 1
    const video = { currentTime: 30 } as HTMLVideoElement
    const feed = new StreamFeed('media:/s/a.mp4', 60, () => video, e)
    await vi.advanceTimersByTimeAsync(200)
    feed.stop()
    expect(source.buffer.removed).toEqual([[0, 20]])
    expect(source.buffer.appended).toEqual([100])
  })

  it('waits for playback to move on when there is nothing far enough behind to remove', async () => {
    const { env: e, source } = env([{ bytes: 100 }])
    source.buffer.full = 1
    const video = { currentTime: 5 } as HTMLVideoElement
    const feed = new StreamFeed('media:/s/a.mp4', 60, () => video, e)
    await vi.advanceTimersByTimeAsync(100)
    expect(source.buffer.appended).toEqual([])
    await vi.advanceTimersByTimeAsync(500)
    feed.stop()
    expect(source.buffer.removed).toEqual([])
    expect(source.buffer.appended).toEqual([100])
  })

  it('stops reading once stopped', async () => {
    const { env: e, ranges } = env([])
    const feed = new StreamFeed('media:/s/a.mp4', 12, () => null, e)
    await vi.advanceTimersByTimeAsync(300)
    feed.stop()
    const reads = ranges.length
    await vi.advanceTimersByTimeAsync(1000)
    expect(ranges.length).toBe(reads)
  })
})
