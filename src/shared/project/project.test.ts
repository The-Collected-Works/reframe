import { describe, expect, it } from 'vitest'
import { migrate } from './migrate'
import { parseProject, PROJECT_VERSION } from './project'

/** A project as Reframe 0.6 saved it (format 1). */
const released = {
  version: 1,
  artboards: [
    {
      id: 'k3j2h1g0',
      name: 'Square',
      width: 1080,
      height: 1080,
      defaults: { fit: 'fill', bgMode: 'color', bgColor: '#000000' },
      overrides: { 'Shoot A/clip.mp4': { scale: 1.2 } }
    }
  ],
  clips: { 'Shoot A/clip.mp4': { start: 1.5, end: null } },
  export: { dir: null, imageFormat: 'png', imageQuality: 0.92, videoCrf: 18 }
}

/** A project as the compositions branch saved it while they were built, still as format 1. */
const branch = {
  ...released,
  items: {
    '~v1': { kind: 'variant', source: 'Shoot A/clip.mp4', name: 'clip 2' },
    '~g1': { kind: 'grid', name: 'Grid 1', root: { id: 'r', children: [] }, gap: 0, padding: 0, radius: 0, bgColor: '#000', duration: null },
    '~l1': { kind: 'layout', name: 'Layout 1', root: { id: 'r', children: [] }, gap: 8, padding: 8, radius: 4, bgColor: '#fff', duration: 5 },
    '~c1': {
      kind: 'composition',
      type: 'bento',
      name: 'Composition 1',
      root: { id: 'r', children: [] },
      gap: 0,
      padding: 0,
      radius: 0,
      bgColor: '#000',
      duration: null
    }
  },
  files: { 'Shoot A/clip.mp4': { size: 10, mtime: 1, hash: 'abc' } }
}

describe('parseProject', () => {
  it('reads this format and earlier ones', () => {
    expect(parseProject(JSON.stringify(released))).toEqual({ file: released, lock: null })
    expect(parseProject(JSON.stringify({ ...released, version: PROJECT_VERSION })).lock).toBeNull()
  })

  it('a newer format is read-only, with what it holds', () => {
    const newer = { ...released, version: PROJECT_VERSION + 1 }
    expect(parseProject(JSON.stringify(newer))).toEqual({ file: newer, lock: { reason: 'newer', version: PROJECT_VERSION + 1 } })
  })

  it('anything else is unreadable, never an empty project', () => {
    for (const text of ['', '{"version": 1, "artb', 'null', '[]', '{"artboards": []}', '{"version": "2"}', '{"version": 0}', '{"version": 1.5}']) {
      expect(parseProject(text), text).toEqual({ file: null, lock: { reason: 'unreadable', backup: false } })
    }
  })
})

describe('migrate', () => {
  it('brings a released format 1 project up to date, keeping everything in it', () => {
    const p = migrate(released)
    expect(p.version).toBe(PROJECT_VERSION)
    expect(p.artboards).toEqual(released.artboards)
    expect(p.clips).toEqual(released.clips)
    expect(p.export).toEqual(released.export)
    expect(p.items).toEqual({})
  })

  it('format 1 compositions saved as "grid" or "layout" become bentos; the rest stay as they were', () => {
    const p = migrate(branch)
    expect(p.items?.['~g1']).toMatchObject({ kind: 'composition', type: 'bento', name: 'Grid 1' })
    expect(p.items?.['~l1']).toMatchObject({ kind: 'composition', type: 'bento', gap: 8, duration: 5 })
    expect(p.items?.['~c1']).toEqual(branch.items['~c1'])
    expect(p.items?.['~v1']).toEqual(branch.items['~v1'])
    expect(p.files).toEqual(branch.files)
  })

  it('leaves this format alone, and the file it was given untouched', () => {
    const now = { ...released, version: PROJECT_VERSION }
    expect(migrate(now)).toBe(now)
    const copy = structuredClone(branch)
    migrate(branch)
    expect(branch).toEqual(copy)
  })

  it('every earlier format has a way up', () => {
    for (let v = 1; v < PROJECT_VERSION; v++) expect(migrate({ ...released, version: v }).version).toBe(PROJECT_VERSION)
  })
})
