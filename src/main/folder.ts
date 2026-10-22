import { promises as fs, watch, type FSWatcher } from 'node:fs'
import { extname, join } from 'node:path'
import type { AssetEntry, FolderScan, MediaKind, ProjectFile } from '@shared/types'

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

export async function scanFolder(dir: string): Promise<FolderScan> {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const assets: AssetEntry[] = []
  for (const e of entries) {
    if (!e.isFile() || e.name.startsWith('.')) continue
    const kind = kindOf(e.name)
    if (!kind) continue
    const path = join(dir, e.name)
    const st = await fs.stat(path)
    assets.push({ name: e.name, path, kind, size: st.size, mtime: st.mtimeMs })
  }
  assets.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))
  return { dir, assets, project: await readProject(dir) }
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

export function watchFolder(dir: string, onChange: () => void): void {
  watcher?.close()
  try {
    watcher = watch(dir, (_event, file) => {
      if (file && (file.startsWith('.') || !kindOf(file))) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(onChange, 400)
    })
  } catch {
    watcher = null
  }
}
