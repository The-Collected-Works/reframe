import { describe, expect, it } from 'vitest'
import type { ProjectFile } from '@shared/types'
import { filesOf, moved, relinked } from './files'
import { emptyProject } from './project'

const fp = (hash: string, size = 10) => ({ size, mtime: 1, hash })

function project(): ProjectFile {
  const p = emptyProject()
  return {
    ...p,
    artboards: [{ ...p.artboards[0], overrides: { 'a.mp4': { zoom: 2 }, '~v': { zoom: 3 }, '~c/s1': { zoom: 4 } } }],
    clips: { 'a.mp4': { start: 1, end: null }, 'b.jpg': { start: 0, end: 2 } },
    items: {
      '~v': { kind: 'variant', source: 'a.mp4', name: 'a copy' },
      '~c': {
        kind: 'composition',
        type: 'bento',
        name: 'c',
        root: {
          id: 'r',
          children: [
            { id: 's1', item: 'a.mp4' },
            { id: 's2', item: '~v' },
            { id: 's3', item: 'd.png' }
          ]
        },
        gap: 0,
        padding: 0,
        radius: 0,
        bgColor: '#000',
        duration: null
      }
    },
    files: { 'a.mp4': fp('A') }
  }
}

describe('filesOf', () => {
  it('finds every file referred to, and no variants or cells', () => {
    expect([...filesOf(project())].sort()).toEqual(['a.mp4', 'b.jpg', 'd.png'])
  })
})

describe('relinked', () => {
  it('moves every reference to the new name', () => {
    const p = relinked(project(), new Map([['a.mp4', 'Shoot/renamed.mp4']]))
    expect([...filesOf(p)].sort()).toEqual(['Shoot/renamed.mp4', 'b.jpg', 'd.png'])
    expect(p.artboards[0].overrides['Shoot/renamed.mp4']).toEqual({ zoom: 2 })
    expect(p.artboards[0].overrides['~v']).toEqual({ zoom: 3 })
    expect(p.clips['Shoot/renamed.mp4']).toEqual({ start: 1, end: null })
    expect(p.items!['~v']).toMatchObject({ source: 'Shoot/renamed.mp4' })
    expect(p.files).toEqual({ 'Shoot/renamed.mp4': fp('A') })
  })

  it('changes nothing without moves', () => {
    const p = project()
    expect(relinked(p, new Map())).toBe(p)
  })
})

describe('moved', () => {
  it('matches a missing file to one with the same contents', () => {
    expect(
      moved({ 'a.mp4': fp('A') }, [
        { name: 'x.mp4', size: 10, hash: 'A' },
        { name: 'y.mp4', size: 10, hash: 'B' }
      ])
    ).toEqual(new Map([['a.mp4', 'x.mp4']]))
  })

  it('needs the same size and contents', () => {
    expect(moved({ 'a.mp4': fp('A') }, [{ name: 'x.mp4', size: 11, hash: 'A' }]).size).toBe(0)
  })

  it('of several copies, takes the one in its folder, or none', () => {
    const copies = [
      { name: 'One/x.mp4', size: 10, hash: 'A' },
      { name: 'Two/x.mp4', size: 10, hash: 'A' }
    ]
    expect(moved({ 'Two/a.mp4': fp('A') }, copies)).toEqual(new Map([['Two/a.mp4', 'Two/x.mp4']]))
    expect(moved({ 'a.mp4': fp('A') }, copies).size).toBe(0)
  })

  it('gives each file found to one missing file', () => {
    expect(moved({ 'a.mp4': fp('A'), 'b.mp4': fp('A') }, [{ name: 'x.mp4', size: 10, hash: 'A' }])).toEqual(new Map([['a.mp4', 'x.mp4']]))
  })
})
