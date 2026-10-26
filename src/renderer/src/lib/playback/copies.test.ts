import { afterEach, describe, expect, it, vi } from 'vitest'
import { Copies, IDLE, SOON } from './copies'
import { fakeHost, settle, video } from './test/fakes'

afterEach(() => void vi.useRealTimers())

describe('Copies', () => {
  it('makes what is on screen before what is made ahead of time, stopping a less urgent one for it', async () => {
    const f = fakeHost()
    const copies = new Copies(f.host)
    copies.prepare([video('a'), video('b')])
    await settle()
    expect(f.running).toMatchObject({ path: '/v/a', edge: 960, background: true })

    copies.want(video('c'), 960)
    await settle()
    expect(f.cancels).toBe(1)
    expect(f.running).toMatchObject({ path: '/v/c', edge: 960, background: false })
  })

  it('makes the smallest copy first (playable soonest), then the sharper one', async () => {
    const f = fakeHost()
    const copies = new Copies(f.host)
    copies.want(video('a'), 1920)
    await settle()
    expect(f.running).toMatchObject({ path: '/v/a', edge: 960 })
    f.running!.finish('/c/a960.mp4')
    await settle()
    expect(f.running).toMatchObject({ path: '/v/a', edge: 1920 })
  })

  it("puts sharper copies after what's likely next, but before the rest", async () => {
    const f = fakeHost()
    const copies = new Copies(f.host)
    copies.prepare([video('later')])
    copies.want(video('now'), 1920)
    copies.want(video('next'), 960, SOON)
    await settle()
    const order: string[] = []
    while (f.running) {
      order.push(`${f.running.path}@${f.running.edge}`)
      f.running.finish(`/c/${order.length}.mp4`)
      await settle()
    }
    expect(order).toEqual(['/v/now@960', '/v/next@960', '/v/now@1920', '/v/later@960'])
  })

  it('stops a copy for anything off screen while something plays, and waits a moment after', async () => {
    vi.useFakeTimers()
    const f = fakeHost()
    const copies = new Copies(f.host)
    copies.prepare([video('a')])
    await settle()
    expect(f.running?.path).toBe('/v/a')

    const done = copies.busy()
    await settle()
    expect(f.cancels).toBe(1)
    expect(f.running).toBeUndefined()

    // What's on screen is still made meanwhile.
    copies.want(video('b'), 960)
    await settle()
    expect(f.running?.path).toBe('/v/b')
    f.running!.finish('/c/b.mp4')
    await settle()
    expect(f.running).toBeUndefined()

    done()
    await vi.advanceTimersByTimeAsync(IDLE - 1)
    expect(f.running).toBeUndefined()
    await vi.advanceTimersByTimeAsync(1)
    await settle()
    expect(f.running?.path).toBe('/v/a')
  })

  it('finds copies made in an earlier session without making them again', async () => {
    const f = fakeHost({ made: ['/v/a@960'] })
    const copies = new Copies(f.host)
    copies.want(video('a'), 960)
    await settle()
    expect(f.calls).toHaveLength(0)
    expect(copies.best(video('a'), 960)?.url).toBe('media:/copies/v/a@960.mp4')
  })

  it("says what's being made and what's waiting, and how far along", async () => {
    const f = fakeHost()
    const copies = new Copies(f.host)
    copies.prepare([video('a'), video('b')])
    await settle()
    expect(copies.state(video('a'))).toEqual({ state: 'making', progress: 0 })
    expect(copies.state(video('b'))).toEqual({ state: 'queued' })

    f.progress({ id: f.running!.id, progress: 0.5 })
    expect(copies.state(video('a'))).toEqual({ state: 'making', progress: 0.5 })
    expect(copies.activity()).toEqual({ label: 'Preparing videos', done: 0, total: 2, progress: 0.5 })

    f.running!.finish('/c/a.mp4')
    await settle()
    expect(copies.state(video('a'))).toBeNull()
    expect(copies.activity()).toMatchObject({ done: 1, total: 2 })
  })

  it('reports progress apart from changes to what is made', async () => {
    const f = fakeHost()
    const copies = new Copies(f.host)
    const changes = vi.fn()
    const steps = vi.fn()
    copies.changed.on(changes)
    copies.progressed.on(steps)
    copies.want(video('a'), 960)
    await settle()
    changes.mockClear()
    for (let i = 1; i <= 5; i++) f.progress({ id: f.running!.id, progress: i / 10 })
    await settle()
    expect(steps).toHaveBeenCalledTimes(5)
    expect(changes).not.toHaveBeenCalled()
  })

  it('looks for a copy again when it fails to load, and gives up after a few tries', async () => {
    const f = fakeHost({ made: ['/v/a@960', '/v/a@1920'] })
    const copies = new Copies(f.host)
    const a = video('a')
    copies.want(a, 960)
    await settle()
    const url = copies.best(a, 960)!.url
    copies.lost(a, url)
    await settle()
    expect(copies.best(a, 960)?.url).toBe(url)
    copies.lost(a, url)
    await settle()
    copies.lost(a, url)
    await settle()
    // Given up on at 960; the 1920 one stands in.
    expect(copies.best(a, 960)?.size).toBe(1920)
  })

  it('stands the original in for a copy that cannot be made', async () => {
    const f = fakeHost()
    const copies = new Copies(f.host)
    const a = { ...video('a'), w: 640, h: 360 }
    copies.want(a, 640)
    await settle()
    f.running!.fail()
    await settle()
    expect(copies.failed(a)).toBe(true)
    expect(copies.pending(a)).toBe(false)
  })
})
