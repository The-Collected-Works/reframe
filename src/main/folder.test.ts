import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { PROJECT_VERSION } from '@shared/project/project'
import type { ProjectFile } from '@shared/types'
import { readProject, restoreProject, saveProject } from './folder'

const project = (name: string, version = PROJECT_VERSION): ProjectFile => ({
  version,
  artboards: [{ id: 'a', name, width: 1080, height: 1080, defaults: {} as ProjectFile['artboards'][0]['defaults'], overrides: {} }],
  clips: {},
  export: {} as ProjectFile['export']
})

const dirs: string[] = []
const folder = () => {
  const d = mkdtempSync(join(tmpdir(), 'reframe-project-'))
  dirs.push(d)
  return d
}
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })))

const at = (dir: string, name = '.reframe.json') => join(dir, name)
const read = (dir: string, name?: string) => readFileSync(at(dir, name), 'utf8')
const nameIn = (dir: string) => JSON.parse(read(dir)).artboards[0].name
const write = (dir: string, data: unknown, name?: string) => writeFileSync(at(dir, name), typeof data === 'string' ? data : JSON.stringify(data))

describe('saving a project', () => {
  it('saves a new project, then keeps saving over its own saves', async () => {
    const d = folder()
    expect(await readProject(d)).toEqual({ file: null, lock: null })
    expect(await saveProject(d, project('One'))).toBeNull()
    expect(await saveProject(d, project('Two'))).toBeNull()
    expect(nameIn(d)).toBe('Two')
  })

  it("won't save over a change made elsewhere, unless told to", async () => {
    const d = folder()
    write(d, project('Mine'))
    await readProject(d)
    write(d, project('Theirs'))
    expect(await saveProject(d, project('Mine, edited'))).toEqual({ reason: 'changed' })
    expect(nameIn(d)).toBe('Theirs')
    expect(await saveProject(d, project('Mine, edited'), true)).toBeNull()
    expect(nameIn(d)).toBe('Mine, edited')
  })

  it('a project file that turns up after opening counts as a change', async () => {
    const d = folder()
    await readProject(d)
    write(d, project('Theirs'))
    expect(await saveProject(d, project('Mine'))).toEqual({ reason: 'changed' })
  })

  it('reading again takes what changed elsewhere as the starting point', async () => {
    const d = folder()
    write(d, project('Mine'))
    await readProject(d)
    write(d, project('Theirs'))
    expect((await readProject(d)).file?.artboards[0].name).toBe('Theirs')
    expect(await saveProject(d, project('Theirs, edited'))).toBeNull()
  })

  it('never writes over a newer format, even told to', async () => {
    const d = folder()
    const newer = JSON.stringify(project('Newer', PROJECT_VERSION + 1))
    write(d, newer)
    const r = await readProject(d)
    expect(r.lock).toEqual({ reason: 'newer', version: PROJECT_VERSION + 1 })
    expect(r.file?.artboards[0].name).toBe('Newer')
    expect(await saveProject(d, project('Mine'))).toEqual(r.lock)
    expect(await saveProject(d, project('Mine'), true)).toEqual(r.lock)
    expect(read(d)).toBe(newer)
  })

  it('notices a project upgraded elsewhere while it was open', async () => {
    const d = folder()
    write(d, project('Mine'))
    await readProject(d)
    write(d, project('Upgraded', PROJECT_VERSION + 1))
    expect(await saveProject(d, project('Mine'), true)).toEqual({ reason: 'newer', version: PROJECT_VERSION + 1 })
  })

  it('keeps an earlier format as it was, once, before first saving it in this one', async () => {
    const d = folder()
    const old = JSON.stringify(project('Old', 1))
    write(d, old)
    await readProject(d)
    expect(await saveProject(d, project('Upgraded'))).toBeNull()
    expect(read(d, '.reframe.v1.json')).toBe(old)
    expect(await saveProject(d, project('Again'))).toBeNull()
    expect(read(d, '.reframe.v1.json')).toBe(old)
    expect(existsSync(at(d, `.reframe.v${PROJECT_VERSION}.json`))).toBe(false)
  })
})

describe('a project file that can’t be read', () => {
  it('keeps a copy of a file that reads cleanly, to restore one that doesn’t', async () => {
    const d = folder()
    const good = JSON.stringify(project('Good'))
    write(d, good)
    await readProject(d)
    expect(read(d, '.reframe.backup.json')).toBe(good)
    write(d, '{"version": 2, "artb')
    expect(await readProject(d)).toEqual({ file: null, lock: { reason: 'unreadable', backup: true } })
    expect(await saveProject(d, project('Empty'))).toEqual({ reason: 'unreadable', backup: true })
    expect((await restoreProject(d)).lock).toBeNull()
    expect(read(d)).toBe(good)
    expect(read(d, '.reframe.unreadable.json')).toBe('{"version": 2, "artb')
  })

  it('starting over keeps the unreadable file aside', async () => {
    const d = folder()
    write(d, 'not json')
    expect((await readProject(d)).lock).toEqual({ reason: 'unreadable', backup: false })
    expect(await saveProject(d, project('New'), true)).toBeNull()
    expect(nameIn(d)).toBe('New')
    expect(read(d, '.reframe.unreadable.json')).toBe('not json')
  })
})
