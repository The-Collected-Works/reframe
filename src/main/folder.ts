import { execFile } from 'node:child_process'
import { promises as fs, watch, type FSWatcher } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { kindOf } from '@shared/media'
import { parseProject, type ProjectLock, type ProjectRead } from '@shared/project'
import type { AssetEntry, FolderScan, MediaKind, ProjectFile, SkippedFolder } from '@shared/types'
import { writeFileAtomic } from './fsutil'

export const PROJECT_FILE = '.reframe.json'
/** The project file as it was when last opened and read without trouble, to restore if it breaks. */
const PROJECT_BACKUP = '.reframe.backup.json'
/** A project file that couldn't be read, kept when it's replaced (by the backup, or on purpose). */
const PROJECT_UNREADABLE = '.reframe.unreadable.json'

/**
 * Marks a folder as Reframe's own output (or one the user excluded): scans skip it and everything
 * inside, whatever it's called and wherever it's moved. Delete the file to include it again.
 */
export const OUTPUT_MARKER = '.reframe-output'
/** Limits, so opening something like a home folder can't crawl a whole drive. */
const MAX_DEPTH = 8
const MAX_FILES = 20000

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
/** Folders read at once while scanning; network drives answer slowly but in parallel. */
const READ_AHEAD = 8

/**
 * Every image and video in `dir` and its subfolders, in folder order: a folder's own files first,
 * then its subfolders. Names are paths relative to `dir` with "/" separators ("Shoot A/clip.mp4"),
 * so top-level names are unchanged from before subfolders were scanned. Hidden files and folders,
 * and folders holding the output marker, are skipped; links to folders aren't followed. Folders
 * are read several at a time, but the result is in order. `withProject` (when opening) also reads
 * the project file; rescans don't need it.
 */
export async function scanFolder(dir: string, withProject = true): Promise<FolderScan> {
  const project = withProject ? await readProject(dir) : null
  if (project) await markLegacyExport(dir, project.file)
  let found = 0
  let truncated = false
  let reading = 0
  const waiting: (() => void)[] = []
  const slot = async () => {
    if (reading >= READ_AHEAD) await new Promise<void>((r) => waiting.push(r))
    reading++
  }
  const release = () => {
    reading--
    waiting.shift()?.()
  }
  type Found = { assets: AssetEntry[]; skipped: SkippedFolder[] }
  const walk = async (abs: string, rel: string, depth: number): Promise<Found> => {
    await slot()
    let entries: import('node:fs').Dirent[] = []
    try {
      entries = await fs.readdir(abs, { withFileTypes: true }).catch(() => [])
      if (rel && entries.some((e) => e.name === OUTPUT_MARKER)) {
        return { assets: [], skipped: [{ path: rel, reason: await markerReason(join(abs, OUTPUT_MARKER)) }] }
      }
    } finally {
      release()
    }
    const files: { name: string; kind: MediaKind }[] = []
    const dirs: string[] = []
    for (const e of entries) {
      if (e.name.startsWith('.')) continue
      const kind = e.isFile() ? kindOf(e.name) : null
      if (kind) files.push({ name: e.name, kind })
      else if (e.isDirectory() && depth < MAX_DEPTH) dirs.push(e.name)
    }
    files.sort((a, b) => collator.compare(a.name, b.name))
    dirs.sort(collator.compare)
    const room = Math.max(0, MAX_FILES - found)
    if (files.length > room) truncated = true
    const kept = files.slice(0, room)
    found += kept.length
    const stats = await Promise.all(kept.map((f) => fs.stat(join(abs, f.name)).catch(() => null)))
    const out: Found = { assets: [], skipped: [] }
    kept.forEach((f, i) => {
      const st = stats[i]
      if (st) out.assets.push({ name: rel ? `${rel}/${f.name}` : f.name, path: join(abs, f.name), kind: f.kind, size: st.size, mtime: st.mtimeMs })
    })
    if (found >= MAX_FILES && dirs.length) truncated = true
    const children = found >= MAX_FILES ? [] : await Promise.all(dirs.map((d) => walk(join(abs, d), rel ? `${rel}/${d}` : d, depth + 1)))
    for (const c of children) {
      out.assets.push(...c.assets)
      out.skipped.push(...c.skipped)
    }
    return out
  }
  const { assets, skipped } = await walk(dir, '', 0)
  // Subfolders read in parallel can overshoot the limit a little; keep the first in order.
  if (assets.length > MAX_FILES) {
    assets.length = MAX_FILES
    truncated = true
  }
  return { dir, assets, project, skipped, truncated }
}

async function markerReason(path: string): Promise<SkippedFolder['reason']> {
  try {
    return JSON.parse(await fs.readFile(path, 'utf8'))?.reason === 'excluded' ? 'excluded' : 'export'
  } catch {
    return 'export'
  }
}

/**
 * Writes the marker into `dir` (creating it). On Windows a leading dot doesn't hide a file, so it
 * also gets the Hidden attribute.
 */
export async function markFolder(dir: string, reason: SkippedFolder['reason']): Promise<void> {
  const file = join(dir, OUTPUT_MARKER)
  if (
    await fs.stat(file).then(
      () => true,
      () => false
    )
  )
    return
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(file, JSON.stringify({ app: 'Reframe', reason }) + '\n')
  if (process.platform === 'win32') execFile('attrib', ['+h', file], { windowsHide: true }, () => {})
}

export async function unmarkFolder(dir: string): Promise<void> {
  await fs.rm(join(dir, OUTPUT_MARKER), { force: true })
}

/** Folders the open folder's scan skipped (relative, "/"-separated), so the watcher ignores them. */
let skippedDirs: string[] = []

/** Takes the skipped folders from the scan now in effect. */
export function setSkipped(folders: SkippedFolder[]): void {
  skippedDirs = folders.map((f) => f.path)
}

/** Remembers a folder as skipped straight away, before the next scan notices its marker. */
export function noteSkipped(rel: string): void {
  if (!skippedDirs.includes(rel)) skippedDirs = [...skippedDirs, rel]
}

/**
 * Before subfolders were scanned, exports went to an unmarked folder (by default "export"). In a
 * folder Reframe has used before, mark wherever it was exporting, so old exports don't turn up as
 * new assets.
 */
async function markLegacyExport(dir: string, project: ProjectFile | null): Promise<void> {
  if (!project) return
  const out = resolve(dir, project.export?.dir ?? 'export')
  const rel = relative(dir, out)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return
  if (
    await fs.stat(out).then(
      (s) => s.isDirectory(),
      () => false
    )
  )
    await markFolder(out, 'export')
}

/**
 * Each folder's project file as last read or written here (null: there was none), so a save can
 * tell whether something else changed it meanwhile.
 */
const known = new Map<string, string | null>()

const readText = (path: string): Promise<string | null> => fs.readFile(path, 'utf8').catch((e: NodeJS.ErrnoException) => (e.code === 'ENOENT' ? null : ''))

/**
 * A folder's project file, read (when opening it, or again to reload). One that reads cleanly is
 * kept as the backup; one that doesn't says whether there's a backup to restore.
 */
export async function readProject(dir: string): Promise<ProjectRead> {
  const text = await readText(join(dir, PROJECT_FILE))
  known.set(dir, text)
  if (text == null) return { file: null, lock: null }
  const read = parseProject(text)
  if (read.lock?.reason === 'unreadable') return { file: null, lock: await unreadable(dir) }
  if (!read.lock && (await readText(join(dir, PROJECT_BACKUP))) !== text) {
    await writeFileAtomic(join(dir, PROJECT_BACKUP), text).catch(() => {})
  }
  return read
}

/** Why an unreadable project file can't be saved over, and whether there's a backup to restore. */
async function unreadable(dir: string): Promise<ProjectLock> {
  const backup = await readText(join(dir, PROJECT_BACKUP))
  return { reason: 'unreadable', backup: !!backup && !parseProject(backup).lock }
}

/** Puts the backup back in place of an unreadable project file (kept aside), and reads it. */
export async function restoreProject(dir: string): Promise<ProjectRead> {
  const backup = await fs.readFile(join(dir, PROJECT_BACKUP), 'utf8')
  const now = await readText(join(dir, PROJECT_FILE))
  if (now && parseProject(now).lock?.reason === 'unreadable') await writeFileAtomic(join(dir, PROJECT_UNREADABLE), now)
  await writeFileAtomic(join(dir, PROJECT_FILE), backup)
  return readProject(dir)
}

let saving: Promise<unknown> = Promise.resolve()

/**
 * Saves a folder's project, unless that would lose something: the file there now is from a newer
 * Reframe (never overwritten), can't be read, or changed since it was read here (both overwritten
 * only with `force`, an unreadable one kept aside first). Returns why it didn't save, or null once
 * it has. Saves run one at a time, each checking what the one before wrote.
 */
export function saveProject(dir: string, project: ProjectFile, force = false): Promise<ProjectLock | null> {
  const path = join(dir, PROJECT_FILE)
  const save = async (): Promise<ProjectLock | null> => {
    const now = await readText(path)
    if (now != null) {
      const lock = parseProject(now).lock
      if (lock?.reason === 'newer') return lock
      if (!force) {
        if (lock) return unreadable(dir)
        if (now !== known.get(dir)) return { reason: 'changed' }
      }
      if (lock) await writeFileAtomic(join(dir, PROJECT_UNREADABLE), now)
    }
    const text = JSON.stringify(project, null, 2)
    await writeFileAtomic(path, text)
    known.set(dir, text)
    return null
  }
  const next = saving.catch(() => {}).then(save)
  saving = next
  return next
}

let watcher: FSWatcher | null = null
let timer: NodeJS.Timeout | null = null

/**
 * Watches `dir` and its subfolders. Changes to media, to markers and to folders trigger a rescan;
 * hidden files and anything inside skipped folders (exports being written, for one) don't. A name
 * that isn't media might be a folder ("Day 1.5"), so it's checked. If the folder itself goes away
 * (deleted, renamed, drive ejected) the watcher stops instead of erroring.
 */
export function watchFolder(dir: string, onChange: () => void): void {
  watcher?.close()
  watcher = null
  const trigger = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(onChange, 400)
  }
  try {
    const w = watch(dir, { recursive: true }, (_event, file) => {
      if (!file) return
      const parts = file.split(/[\\/]/)
      const rel = parts.join('/')
      if (parts.some((p) => p.startsWith('.') && p !== OUTPUT_MARKER)) return
      if (skippedDirs.some((d) => rel === d || rel.startsWith(d + '/'))) return
      const name = parts[parts.length - 1]
      if (name === OUTPUT_MARKER || kindOf(name)) return trigger()
      // Maybe a folder (added, removed or renamed): rescan unless it's plainly another file.
      fs.stat(join(dir, file)).then(
        (st) => st.isDirectory() && trigger(),
        () => trigger()
      )
    })
    w.on('error', () => {
      w.close()
      if (watcher === w) watcher = null
    })
    watcher = w
  } catch {
    watcher = null
  }
}
