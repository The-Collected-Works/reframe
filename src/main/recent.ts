import { promises as fs, statSync } from 'node:fs'
import { basename, join, normalize } from 'node:path'
import { app, Menu } from 'electron'

/** How many recent folders are remembered (the menus show fewer). */
const KEEP = 8
const SHOW = 5

type State = { lastFolder?: string; recent?: string[] }
const statePath = () => join(app.getPath('userData'), 'state.json')

export async function readState(): Promise<State> {
  try {
    return JSON.parse(await fs.readFile(statePath(), 'utf8'))
  } catch {
    return {}
  }
}

const same = (a: string, b: string) =>
  process.platform === 'win32' || process.platform === 'darwin' ? normalize(a).toLowerCase() === normalize(b).toLowerCase() : normalize(a) === normalize(b)

const isDir = (p: string) => fs.stat(p).then((s) => s.isDirectory(), () => false)

/** Recent folders that still exist (moved, deleted or disconnected ones are left out), newest first. */
export async function recentFolders(): Promise<string[]> {
  const { recent = [] } = await readState()
  const exists = await Promise.all(recent.map(isDir))
  return recent.filter((_, i) => exists[i])
}

/** Records an opened folder as the last and most recent one. */
export async function remember(dir: string): Promise<void> {
  const state = await readState()
  const recent = [dir, ...(state.recent ?? []).filter((d) => !same(d, dir))].slice(0, KEEP)
  await fs.writeFile(statePath(), JSON.stringify({ ...state, lastFolder: dir, recent })).catch(() => {})
  await updateSystemMenus()
}

export async function forget(dir: string): Promise<string[]> {
  const state = await readState()
  const recent = (state.recent ?? []).filter((d) => !same(d, dir))
  await fs.writeFile(statePath(), JSON.stringify({ ...state, recent })).catch(() => {})
  await updateSystemMenus()
  return recentFolders()
}

let openRequest: (dir: string) => void = () => {}

/**
 * The same folders in the OS's own menus: a "Recent folders" section in the Windows taskbar's
 * jump list (each relaunches the app with that folder, which a running copy picks up through
 * `second-instance`), and the macOS Dock menu.
 */
export async function updateSystemMenus(onOpen?: (dir: string) => void): Promise<void> {
  if (onOpen) openRequest = onOpen
  const folders = (await recentFolders()).slice(0, SHOW)
  try {
    if (process.platform === 'win32' && app.isPackaged) {
      app.setJumpList(
        folders.length
          ? [
              {
                type: 'custom',
                name: 'Recent folders',
                items: folders.map((d) => ({
                  type: 'task' as const,
                  title: basename(d) || d,
                  description: d,
                  program: process.execPath,
                  args: `"${d}"`,
                  iconPath: process.execPath,
                  iconIndex: 0
                }))
              }
            ]
          : null
      )
    } else if (process.platform === 'darwin') {
      app.dock?.setMenu(Menu.buildFromTemplate(folders.map((d) => ({ label: basename(d) || d, click: () => openRequest(d) }))))
    }
  } catch {
    // Jump lists can be turned off in Windows settings; the in-app list still works.
  }
}

/** A folder passed on the command line (how the jump list opens one), if any. */
export function folderArg(argv: string[]): string | null {
  const args = argv.slice(app.isPackaged ? 1 : 2).filter((a) => !a.startsWith('-'))
  for (const a of args.reverse()) {
    try {
      if (statSync(a).isDirectory()) return a
    } catch {
      // Not a path.
    }
  }
  return null
}
