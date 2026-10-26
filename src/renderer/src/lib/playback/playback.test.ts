import { describe, expect, it, vi } from 'vitest'
import { Copies, type MediaFile } from './copies'
import { Playback, type Track } from './playback'
import { FakeClip, fakeHost, manualClock, settle, video } from './test/fakes'

function setup(opts: { made?: string[]; streams?: boolean; originals?: boolean } = {}) {
  const f = fakeHost(opts)
  const copies = new Copies(f.host)
  const clock = manualClock()
  const clips: FakeClip[] = []
  const playback = new Playback({
    copies,
    host: f.host,
    originals: opts.originals,
    scheduler: clock.scheduler,
    clip: () => {
      const c = new FakeClip()
      clips.push(c)
      return c
    }
  })
  return { f, copies, clock, clips, playback }
}

const track = (id: string, file: MediaFile, extra: Partial<Track> = {}): Track => ({
  id,
  file,
  start: 0,
  length: file.duration,
  end: 'loop',
  need: 900,
  ...extra
})

describe('Playback', () => {
  describe('where each track plays from', () => {
    it('its copy, once there is one', async () => {
      const { clips, playback } = setup({ made: ['/v/a@960'] })
      playback.setTracks([track('a', video('a'))])
      await settle()
      expect(clips[0].src).toBe('media:/copies/v/a@960.mp4')
    })

    it('nothing of its own before that (its thumbnail stands in)', async () => {
      const { clips, playback } = setup()
      playback.setTracks([track('a', video('a'))])
      await settle()
      expect(clips[0].src).toBe('')
      expect(playback.frame('a')).toBeNull()
    })

    it('the original meanwhile, where that is allowed', async () => {
      const { clips, playback } = setup({ originals: true })
      playback.setTracks([track('a', video('a'))])
      await settle()
      expect(clips[0].src).toBe('media:/v/a')
    })

    it('the copy being made, as it is written, then the finished copy', async () => {
      const { f, clips, playback } = setup({ streams: true })
      playback.setTracks([track('a', video('a'))])
      await settle()
      expect(f.running).toMatchObject({ path: '/v/a', stream: true })

      f.progress({ id: f.running!.id, progress: 0.1, stream: '/s/a.mp4' })
      await settle()
      expect(clips[0]).toMatchObject({ src: 'media:/s/a.mp4', stream: true })

      f.running!.finish('/c/a.mp4')
      await settle()
      expect(clips[0]).toMatchObject({ src: 'media:/c/a.mp4', stream: false })
    })

    it('a sharper copy once the picture is bigger on screen', async () => {
      const { clips, playback } = setup({ made: ['/v/a@960', '/v/a@1920'] })
      const a = video('a')
      playback.setTracks([track('a', a)])
      await settle()
      expect(clips[0].src).toContain('@960')
      playback.setTracks([track('a', a, { need: 1800 })])
      await settle()
      expect(clips[0].src).toContain('@1920')
    })
  })

  describe('the clock', () => {
    it('runs while playing; a looping track wraps round, a holding one stops on its last frame', async () => {
      const { clips, clock, playback } = setup({ made: ['/v/a@960', '/v/b@960'] })
      playback.setTracks([track('a', video('a'), { length: 4 }), track('b', video('b'), { length: 2, end: 'hold' })])
      playback.setRange({ start: 0, end: 4 })
      await settle()
      const [a, b] = clips
      playback.play()

      clock.advance(1000)
      expect(playback.time).toBeCloseTo(1)
      expect(a.follows.at(-1)).toEqual({ t: 1, jump: false })
      expect(b.follows.at(-1)).toEqual({ t: 1, jump: false })

      clock.advance(2000)
      expect(playback.time).toBeCloseTo(3)
      expect(b.playing).toBe(false)
      expect(b.seeks.at(-1)).toBeCloseTo(2 - 1 / 60)

      // Round the end of the range: everything starts over together.
      clock.advance(1500)
      expect(playback.time).toBeCloseTo(0.5)
      expect(a.follows.at(-1)).toEqual({ t: 0.5, jump: true })
    })

    it("isn't disturbed by the copies' progress while it plays", async () => {
      const { f, clips, clock, playback } = setup({ streams: true })
      playback.setTracks([track('a', video('a'))])
      playback.setRange({ start: 0, end: 10 })
      await settle()
      f.progress({ id: f.running!.id, progress: 0.1, stream: '/s/a.mp4' })
      await settle()
      playback.play()
      clock.advance(16)
      const a = clips[0]
      const seeks = a.seeks.length
      const sources = a.sources
      for (let i = 2; i <= 9; i++) {
        f.progress({ id: f.running!.id, progress: i / 10 })
        await settle()
        clock.advance(16)
      }
      expect(a.seeks.length).toBe(seeks)
      expect(a.sources).toBe(sources)
      expect(a.follows.filter((x) => x.jump)).toHaveLength(0)
    })

    it('the same tracks again (a re-render) change nothing that plays', async () => {
      const { clips, playback } = setup({ made: ['/v/a@960'] })
      playback.setTracks([track('a', video('a'))])
      await settle()
      const a = clips[0]
      const seeks = a.seeks.length
      playback.setTracks([track('a', video('a'))])
      playback.setTracks([track('a', video('a'))])
      await settle()
      expect(clips).toHaveLength(1)
      expect(a.sources).toBe(1)
      expect(a.seeks.length).toBe(seeks)
    })

    it('scrubbing stops the clock and seeks; it plays on where the scrub ends', async () => {
      const { clips, playback } = setup({ made: ['/v/a@960'] })
      playback.setTracks([track('a', video('a'))])
      playback.setRange({ start: 0, end: 10 })
      await settle()
      playback.play()
      playback.scrubStart()
      expect(playback).toMatchObject({ playing: false, scrubbing: true })
      playback.scrubTo(2)
      expect(clips[0].seeks.at(-1)).toBe(2)
      playback.scrubEnd(3)
      expect(playback).toMatchObject({ playing: true, scrubbing: false, time: 3 })
    })

    it('stops, and stays stopped, while held', async () => {
      const { playback } = setup({ made: ['/v/a@960'] })
      playback.setTracks([track('a', video('a'))])
      playback.setRange({ start: 0, end: 10 })
      playback.play()
      playback.setHold(true)
      expect(playback.playing).toBe(false)
      playback.toggle()
      expect(playback.playing).toBe(false)
    })
  })

  it("holds back copies of what isn't on screen while it plays", async () => {
    const { f, copies, playback } = setup({ made: ['/v/a@960'] })
    copies.prepare([video('other')])
    playback.setTracks([track('a', video('a'))])
    playback.setRange({ start: 0, end: 10 })
    await settle()
    expect(f.running?.path).toBe('/v/other')
    playback.play()
    await settle()
    expect(f.cancels).toBe(1)
  })

  it('lets go of everything when destroyed', async () => {
    const { f, clips, playback } = setup()
    playback.setTracks([track('a', video('a'))])
    await settle()
    expect(f.running?.path).toBe('/v/a')
    const changed = vi.fn()
    playback.changed.on(changed)
    playback.destroy()
    await settle()
    expect(clips[0].released).toBe(true)
    // Copies still arriving no longer reach it.
    f.running!.finish('/c/a.mp4')
    await settle()
    expect(changed).not.toHaveBeenCalled()
  })
})
