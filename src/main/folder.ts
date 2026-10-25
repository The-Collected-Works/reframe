import { execFile } from 'node:child_process'
import { promises as fs, watch, type FSWatcher } from 'node:fs'
import { extname, isAbsolute, join, relative, resolve } from 'node:path'
import type { AssetEntry, FolderScan, MediaKind, ProjectFile, SkippedFolder } from '@shared/types'

export const PROJECT_FILE = '.reframe.json'

const KINDS: Record<string, MediaKind> = {
  '.jpg': 'image',
  '.jpeg': 'image',
  '.png': 'image',
  '.webp': 'image',
  '.gif': 'image',
  '.avif': 'image',
  '.bmp': 'image',
  '.mp4': 'video',
  '.m4v': 'video',
  '.mov': 'video',
  '.webm': 'video',
  '.mkv': 'video',
  '.avi': 'video'
}

export function kindOf(path: string): MediaKind | null {
  return KINDS[extname(path).toLowerCase()] ?? null
}

/**
 * Marks a folder as Reframe's own output (or one the user excluded): scans skip it and everything
 * inside, whatever it's called and wherever it's moved. Delete the file to include it again.
 */
export const OUTPUT_MARKER = '.reframe-output'
/** Limits, so opening something like a home folder can't crawl a whole drive. */
const MAX_DEPTH = 8
const MAX_FILES = 20000

const natural = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })

/** Folders skipped by the last scan (relative, "/"-separated), so the watcher can ignore them. */
let skippedDirs: string[] = []

/**
 * Every image and video in `dir` and its subfolders, in folder order: a folder's own files first,
 * then its subfolders. Names are paths relative to `dir` with "/" separators ("Shoot A/clip.mp4"),
 * so top-level names are unchanged from before subfolders were scanned. Hidden files and folders,
 * and folders holding the output marker, are skipped; links to folders aren't followed.
 */
export async function scanFolder(dir: string): Promise<FolderScan> {
  const project = await readProject(dir)
  await markLegacyExport(dir, project)
  const assets: AssetEntry[] = []
  const skipped: SkippedFolder[] = []
  let truncated = false
  const walk = async (abs: string, rel: string, depth: number): Promise<void> => {
    const entries = await fs.readdir(abs, { withFileTypes: true }).catch(() => [])
    if (rel && entries.some((e) => e.name === OUTPUT_MARKER)) {
      skipped.push({ path: rel, reason: await markerReason(join(abs, OUTPUT_MARKER)) })
      return
    }
    const files: { name: string; kind: MediaKind }[] = []
    const dirs: string[] = []
    for (const e of entries) {
      if (e.name.startsWith('.')) continue
      const kind = e.isFile() ? kindOf(e.name) : null
      if (kind) files.push({ name: e.name, kind })
      else if (e.isDirectory() && depth < MAX_DEPTH) dirs.push(e.name)
    }
    files.sort((a, b) => natural(a.name, b.name))
    dirs.sort(natural)
    const room = MAX_FILES - assets.length
    if (files.length > room) truncated = true
    const stats = await Promise.all(files.slice(0, Math.max(0, room)).map((f) => fs.stat(join(abs, f.name)).catch(() => null)))
    files.slice(0, stats.length).forEach((f, i) => {
      const st = stats[i]
      if (st) assets.push({ name: rel ? `${rel}/${f.name}` : f.name, path: join(abs, f.name), kind: f.kind, size: st.size, mtime: st.mtimeMs })
    })
    for (const d of dirs) {
      if (assets.length >= MAX_FILES) return void (truncated = true)
      await walk(join(abs, d), rel ? `${rel}/${d}` : d, depth + 1)
    }
  }
  await walk(dir, '', 0)
  skippedDirs = skipped.map((f) => f.path)
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
  if (await fs.stat(file).then(() => true, () => false)) return
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(file, JSON.stringify({ app: 'Reframe', reason }) + '\n')
  if (process.platform === 'win32') execFile('attrib', ['+h', file], { windowsHide: true }, () => {})
}

export async function unmarkFolder(dir: string): Promise<void> {
  await fs.rm(join(dir, OUTPUT_MARKER), { force: true })
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
  if (await fs.stat(out).then((s) => s.isDirectory(), () => false)) await markFolder(out, 'export')
}

async function readProject(dir: string): Promise<ProjectFile | null> {
  try {
    const data = JSON.parse(await fs.readFile(join(dir, PROJECT_FILE), 'utf8'))
    return data?.version === 1 ? data : null
  } catch {
    return null
  }
}

export async function saveProject(dir: string, project: ProjectFile): Promise<void> {
  const target = join(dir, PROJECT_FILE)
  const tmp = target + '.tmp'
  await fs.writeFile(tmp, JSON.stringify(project, null, 2))
  await fs.rename(tmp, target)
}

let watcher: FSWatcher | null = null
let timer: NodeJS.Timeout | null = null

/**
 * Watches `dir` and its subfolders. Changes to media, to folders (names without an extension) and
 * to markers trigger a rescan; hidden files and anything inside skipped folders (exports being
 * written, for one) don't.
 */
export function watchFolder(dir: string, onChange: () => void): void {
  watcher?.close()
  try {
    watcher = watch(dir, { recursive: true }, (_event, file) => {
      if (!file) return
      const parts = file.split(/[\\/]/)
      const rel = parts.join('/')
      if (skippedDirs.some((d) => rel === d || rel.startsWith(d + '/'))) return
      const name = parts[parts.length - 1]
      const relevant = name === OUTPUT_MARKER || (!parts.some((p) => p.startsWith('.')) && (kindOf(name) || !extname(name)))
      if (!relevant) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(onChange, 400)
    })
  } catch {
    watcher = null
  }
}
