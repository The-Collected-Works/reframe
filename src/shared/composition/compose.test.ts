import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../framing/framing'
import type { Artboard, BentoComposition, BentoNode } from '../types'
import { compose, layerTime, type LayerSource } from './compose'

const board = (width = 1000, height = 500, extra: Partial<Artboard> = {}): Artboard => ({
  id: 'b',
  name: 'Wide',
  width,
  height,
  defaults: DEFAULT_SETTINGS,
  overrides: {},
  ...extra
})

const bento = (root: BentoNode, extra: Partial<BentoComposition> = {}): BentoComposition => ({
  kind: 'composition',
  type: 'bento',
  name: 'C',
  root,
  gap: 0,
  padding: 0,
  radius: 8,
  bgColor: '#123456',
  duration: null,
  ...extra
})

const sources: Record<string, LayerSource> = {
  'a.mp4': { name: 'a.mp4', kind: 'video', w: 1920, h: 1080, duration: 10 },
  'b.mp4': { name: 'b.mp4', kind: 'video', w: 1920, h: 1080, duration: 4 },
  'c.jpg': { name: 'c.jpg', kind: 'image', w: 800, h: 600, duration: 0 }
}

const ctx = (b: Artboard, clips: Record<string, { start: number; end: number | null }> = {}) => ({
  board: b,
  source: (k: string) => sources[k] ?? null,
  clip: (k: string) => clips[k] ?? { start: 0, end: null }
})

const row = (...items: (string | null)[]): BentoNode => ({ id: 'root', children: items.map((item, i) => ({ id: `s${i}`, item })) })

describe('compose', () => {
  it('makes a layer per bento cell: its source, place, corners and background', () => {
    const c = compose('~c', bento(row('a.mp4', 'c.jpg')), ctx(board()))
    expect(c).toMatchObject({ key: '~c', width: 1000, height: 500, background: '#123456' })
    expect(c.layers.map((l) => [l.id, l.source?.name, l.rect, l.radius])).toEqual([
      ['s0', 'a.mp4', { x: 0, y: 0, w: 500, h: 500 }, 8],
      ['s1', 'c.jpg', { x: 500, y: 0, w: 500, h: 500 }, 8]
    ])
  })

  it('frames each layer as its artboard says', () => {
    const b = board(1000, 500, { overrides: { '~c/s1': { zoom: 2 } } })
    const c = compose('~c', bento(row('a.mp4', 'c.jpg')), ctx(b))
    expect(c.layers[0].settings.zoom).toBe(1)
    expect(c.layers[1].settings.zoom).toBe(2)
  })

  it('leaves a cell empty when its item is gone', () => {
    const c = compose('~c', bento(row('gone.mp4', null)), ctx(board()))
    expect(c.layers.map((l) => l.source)).toEqual([null, null])
  })

  it('times a video layer by its trim, and runs as long as its longest video', () => {
    const c = compose('~c', bento(row('a.mp4', 'b.mp4', 'c.jpg')), ctx(board(), { 'a.mp4': { start: 2, end: 8 } }))
    expect(c.layers.map((l) => [l.start, l.length])).toEqual([
      [2, 6],
      [0, 4],
      [0, 0]
    ])
    expect(c.duration).toBe(6)
  })

  it('runs for its set duration instead, when it has one', () => {
    const c = compose('~c', bento(row('a.mp4'), { duration: 3 }), ctx(board()))
    expect(c.duration).toBe(3)
  })

  it('is a still (no duration) without video', () => {
    expect(compose('~c', bento(row('c.jpg')), ctx(board())).duration).toBe(0)
  })

  it("follows the artboard's proportions for a split, when it has some", () => {
    const b = board(1000, 500, { splits: { '~c': { root: { weights: [3, 1] } } } })
    const c = compose('~c', bento(row('a.mp4', 'c.jpg')), ctx(b))
    expect(c.layers.map((l) => l.rect.w)).toEqual([750, 250])
  })
})

describe('layerTime', () => {
  const layer = { start: 2, length: 4 }
  it('loops round its stretch', () => {
    expect(layerTime(1, { ...layer, end: 'loop' })).toBe(3)
    expect(layerTime(5, { ...layer, end: 'loop' })).toBe(3)
  })
  it('holds its last frame once played through', () => {
    expect(layerTime(1, { ...layer, end: 'hold' })).toBe(3)
    expect(layerTime(9, { ...layer, end: 'hold' })).toBeCloseTo(2 + 4 - 1 / 60)
  })
  it('stays put when it has no length (a still)', () => {
    expect(layerTime(7, { start: 0, length: 0, end: 'loop' })).toBe(0)
  })
})
