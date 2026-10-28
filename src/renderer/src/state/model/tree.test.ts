import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Artboard } from '@shared/types'
import { storedView, VIEW_DEFAULTS, type ViewPrefs } from '../prefs'
import type { Entry } from './items'
import { newBoard } from './project'
import { gridLayout, valueCounts, valuesOf } from './tree'

const file = (name: string, kind: 'image' | 'video'): Entry => ({ name, kind, label: name, path: '/f/' + name, size: 1, mtime: 1 })
const all: Entry[] = [
  { name: '~still', kind: 'composition', label: 'Still', path: '', size: 0, mtime: 0, moves: false },
  { name: '~moving', kind: 'composition', label: 'Moving', path: '', size: 0, mtime: 0, moves: true },
  file('a.jpg', 'image'),
  file('b.jpg', 'image'),
  file('c.mp4', 'video'),
  { ...file('c.mp4', 'video'), name: '~v', label: 'c copy', source: 'c.mp4' }
]

/** A board where b.jpg is left out and c.mp4 is adjusted (and the still composition's cell). */
function board(): Artboard {
  const b = newBoard('Square', 1080, 1080)
  b.overrides = { 'b.jpg': { skip: true }, 'c.mp4': { zoom: 1.2 }, '~still/s1': { offsetX: 0.1 } }
  return b
}

const shown = (hidden: string[], b: Artboard | null = board(), held?: Set<string>) =>
  gridLayout(all, { ...VIEW_DEFAULTS, group: false, hidden }, [], [], b, held).visible.map((e) => e.name)

describe('view filters', () => {
  it('show everything by default', () => {
    expect(shown([])).toEqual(['~moving', '~still', 'a.jpg', 'b.jpg', 'c.mp4', '~v'])
  })

  it('hide what’s left out on this artboard, and only that', () => {
    expect(shown(['export:left-out'])).toEqual(['~moving', '~still', 'a.jpg', 'c.mp4', '~v'])
    expect(shown(['export:included'])).toEqual(['b.jpg'])
  })

  it('add up within a facet and narrow across them', () => {
    expect(shown(['item:source', 'item:composition'])).toEqual(['~v'])
    expect(shown(['media:image', 'item:variant'])).toEqual(['~moving', 'c.mp4'])
    expect(shown(['framing:default'])).toEqual(['~still', 'c.mp4'])
  })

  it('count a composition as a video when there’s one in it', () => {
    expect(valuesOf(all[0], null)).toEqual([
      ['item', 'composition'],
      ['media', 'image']
    ])
    expect(valuesOf(all[1], null)[1]).toEqual(['media', 'video'])
  })

  it('keep held items, saying which are shown only for that', () => {
    const layout = gridLayout(all, { ...VIEW_DEFAULTS, group: false, hidden: ['export:left-out'] }, [], [], board(), new Set(['b.jpg', 'a.jpg']))
    expect(layout.visible.map((e) => e.name)).toContain('b.jpg')
    expect([...layout.held]).toEqual(['b.jpg'])
  })

  it('count each value among what the other facets let through', () => {
    const counts = valueCounts(all, ['media:video'], board())
    // Images: a, b and the still composition. Videos would bring back c, its variant, and the moving one.
    expect(counts.get('media:image')).toBe(3)
    expect(counts.get('media:video')).toBe(3)
    // The other facets count only what shows: no videos.
    expect(counts.get('item:source')).toBe(2)
    expect(counts.get('item:variant')).toBeUndefined()
    expect(counts.get('export:left-out')).toBe(1)
  })
})

describe('stored view options', () => {
  afterEach(() => vi.unstubAllGlobals())
  const stored = (v: unknown): ViewPrefs => {
    vi.stubGlobal('localStorage', { getItem: () => JSON.stringify(v), setItem: () => {} })
    return storedView()
  }

  it('turn filters that showed only some things into hiding the rest', () => {
    expect(stored({ filters: ['videos'] }).hidden).toEqual(['media:image'])
    expect(stored({ filters: ['variants', 'compositions', 'excluded'] }).hidden).toEqual(['item:source', 'export:included'])
    expect(stored({ filter: 'images' }).hidden).toEqual(['media:video'])
    expect(stored({ filters: [] }).hidden).toEqual([])
  })

  it('keep only values that exist, once each', () => {
    expect(stored({ hidden: ['export:left-out', 'nope', 'export:left-out', 3] }).hidden).toEqual(['export:left-out'])
  })
})
