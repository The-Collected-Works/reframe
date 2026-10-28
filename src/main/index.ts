import { createReadStream, promises as fs } from 'node:fs'
import { dirname, isAbsolute, join, normalize, relative, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { app, BrowserWindow, dialog, ipcMain, Menu, protocol, shell } from 'electron'
import { mimeOf } from '@shared/media/media'
import type { ColorMeta, FolderScan, CompositionExportJob, OverlayTint, ProjectFile, VideoExportJob } from '@shared/types'
import {
  cacheSize,
  cancelCopy,
  cancelExport,
  clearCache,
  clearOldProxies,
  copiesMade,
  copy,
  exportComposition,
  exportVideo,
  frame,
  poster,
  stopWorker
} from './jobs'
import { contentHash } from './fsutil'
import { markFolder, noteSkipped, readProject, restoreProject, saveProject, scanFolder, setSkipped, unmarkFolder, watchFolder } from './folder'
import { installUpdate, pollAutoUpdate, updateStatus } from './autoupdate'
import { folderArg, forget, readState, recentFolders, remember, updateSystemMenus } from './recent'
import { checkForUpdate, openRelease } from './updates'

protocol.registerSchemesAsPrivileged([
  { scheme: 'media', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }
])

// Dev builds get their own profile, so running dev alongside the packaged app doesn't make the two
// fight over one cache directory ("Unable to move the cache: Access is denied").
if (!app.isPackaged && !app.commandLine.hasSwitch('user-data-dir')) {
  app.setPath('userData', join(app.getPath('appData'), 'Reframe Dev'))
}

// One instance per profile: launching again focuses the open window instead of starting a rival.
const primary = !app.isPackaged || app.requestSingleInstanceLock()
if (!primary) app.quit()

const BG = '#111113'
let win: BrowserWindow | null = null
let currentDir: string | null = null

/** Strictly inside `root` (not `root` itself), by path alone. */
const within = (root: string, path: string) => {
  const rel = relative(root, path)
  return !!rel && !rel.startsWith('..') && !isAbsolute(rel)
}

/**
 * The files the renderer may read: exactly the assets of the open folder's latest scan, plus the
 * playback copies handed out for them. Every path the renderer reads comes from one of those, and
 * the scan never follows links, so one lookup replaces any checking of where a path leads. Copies
 * are kept apart, since a rescan (any change in the folder) replaces the scan's set, and a copy
 * still in use must stay readable.
 */
let readable = new Set<string>()
const copiesOut = new Set<string>()

/** Where exports may be written: the folders the export dialog declared (see mark-output). */
const outputRoots = new Set<string>()
const inOutput = (path: string) => [...outputRoots].some((root) => within(root, normalize(path)))

function canRead(path: string): boolean {
  const p = normalize(path)
  return readable.has(p) || copiesOut.has(p)
}

function mustRead(path: string): void {
  if (!canRead(path)) throw new Error('Not in the open folder')
}

/** Makes a scan the one in effect: what the renderer may read, and what the watcher ignores. */
function adopt(scan: FolderScan): FolderScan {
  readable = new Set(scan.assets.map((a) => normalize(a.path)))
  setSkipped(scan.skipped)
  return scan
}

/** A folder path from the renderer, relative to the open one ("Shoot A/Rejects"), made absolute. */
function subfolder(rel: string): string {
  if (!currentDir) throw new Error('No folder open')
  const abs = resolve(currentDir, rel)
  if (!within(currentDir, abs)) throw new Error('Not in the open folder')
  return abs
}

/**
 * Opens a folder: watch it, scan it, remember it. Opens can overlap (the launch reopening the last
 * folder while another is picked); only the newest takes effect, and an older one fails.
 */
let openGen = 0
async function open(path: string): Promise<FolderScan> {
  const gen = ++openGen
  const dir = normalize((await fs.stat(path)).isDirectory() ? path : dirname(path))
  if (gen !== openGen) throw new Error('superseded')
  // Watch first, so nothing added during a long scan is missed.
  currentDir = dir
  readable = new Set()
  watchFolder(dir, () => win?.webContents.send('folder-changed'))
  const scan = await scanFolder(dir)
  if (gen !== openGen) throw new Error('superseded')
  remember(dir).catch(() => {})
  return adopt(scan)
}

/**
 * Scans the open folder again. One scan at a time: asked for while one is running, it runs once
 * more when that finishes, and every caller gets the newest result.
 */
let rescanning: Promise<FolderScan | null> | null = null
let rescanAgain = false
function rescan(): Promise<FolderScan | null> {
  if (rescanning) {
    rescanAgain = true
    return rescanning
  }
  rescanning = (async () => {
    let scan: FolderScan | null = null
    do {
      rescanAgain = false
      const dir = currentDir
      scan = dir ? await scanFolder(dir, false) : null
      if (scan && scan.dir !== currentDir) scan = null
    } while (rescanAgain)
    return scan && adopt(scan)
  })().finally(() => {
    rescanning = null
  })
  return rescanning
}

function serveMedia(req: Request): Promise<Response> | Response {
  const path = normalize(decodeURIComponent(new URL(req.url).pathname.slice(1)))
  return canRead(path) ? respond(req, path) : new Response(null, { status: 403 })
}

function respond(req: Request, path: string): Promise<Response> {
  return fs.stat(path).then(
    (st) => {
      const headers: Record<string, string> = {
        'Content-Type': mimeOf(path),
        'Accept-Ranges': 'bytes',
        'Access-Control-Allow-Origin': '*'
      }
      if (st.size === 0) return new Response(null, { status: 200, headers: { ...headers, 'Content-Length': '0' } })
      const m = /bytes=(\d*)-(\d*)/.exec(req.headers.get('range') ?? '')
      let start = 0
      let end = st.size - 1
      if (m) {
        if (m[1]) {
          start = Number(m[1])
          if (m[2]) end = Math.min(end, Number(m[2]))
        } else if (m[2]) {
          start = Math.max(0, st.size - Number(m[2]))
        }
        if (start > end) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${st.size}` } })
        headers['Content-Range'] = `bytes ${start}-${end}/${st.size}`
      }
      headers['Content-Length'] = String(end - start + 1)
      const body = Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream
      return new Response(body, { status: m ? 206 : 200, headers })
    },
    () => new Response(null, { status: 404 })
  )
}

function createWindow() {
  const mac = process.platform === 'darwin'
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    backgroundColor: BG,
    titleBarStyle: mac ? 'hiddenInset' : 'hidden',
    // 47px: the top bar is 48 including its 1px bottom border, which should run under the buttons.
    ...(mac ? { trafficLightPosition: { x: 18, y: 17 } } : { titleBarOverlay: { color: BG, symbolColor: '#8b8b93', height: 47 } }),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true
    }
  })
  win.once('ready-to-show', () => win?.show())
  // Lets open popovers close when the window is dragged by its title bar (those clicks never
  // reach the page).
  win.on('will-move', () => win?.webContents.send('window-moving'))
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  // The window only ever shows the app (the dev server's reloads aside).
  win.webContents.on('will-navigate', (e, url) => {
    if (!process.env.ELECTRON_RENDERER_URL || !url.startsWith(process.env.ELECTRON_RENDERER_URL)) e.preventDefault()
  })
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(__dirname, '../renderer/index.html'))
}

function setMenu() {
  if (process.platform !== 'darwin') return Menu.setApplicationMenu(null)
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { role: 'appMenu' },
      { role: 'editMenu' },
      {
        label: 'View',
        submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'togglefullscreen' }]
      },
      { role: 'windowMenu' }
    ])
  )
}

ipcMain.handle('open-folder', async () => {
  const res = await dialog.showOpenDialog(win!, { properties: ['openDirectory'] })
  return res.canceled || !res.filePaths[0] ? null : open(res.filePaths[0])
})
ipcMain.handle('scan-folder', (_e, dir: string) => open(dir))
// Rescans the open folder without reopening it (no new watcher, no recent-folders update).
ipcMain.handle('rescan-folder', () => rescan())
// Leave a subfolder out of the project, or bring it back: the marker travels with the folder.
ipcMain.handle('exclude-folder', async (_e, rel: string) => {
  await markFolder(subfolder(rel), 'excluded')
  noteSkipped(rel)
})
ipcMain.handle('include-folder', (_e, rel: string) => unmarkFolder(subfolder(rel)))
// Export destinations get the marker before anything is written, so exports never show up as
// assets. `dirs` is the destination, then its artboards' folders, and one marker goes as high as
// it can: the destination's skips everything inside it, so its artboards' folders lose theirs (from
// before). The open folder itself (or a folder containing it) is never marked: that would hide the
// whole project; exports always go into a subfolder per artboard, which is marked instead.
ipcMain.handle('mark-output', async (_e, dirs: string[]) => {
  const marked: string[] = []
  for (const d of dirs) {
    const abs = normalize(d)
    outputRoots.add(abs)
    if (currentDir && (abs === currentDir || within(abs, currentDir))) continue
    if (marked.some((m) => within(m, abs))) {
      await unmarkFolder(abs, 'export')
      continue
    }
    await markFolder(abs, 'export')
    marked.push(abs)
    if (currentDir && within(currentDir, abs)) noteSkipped(relative(currentDir, abs).split(/[\\/]/).join('/'))
  }
})
ipcMain.handle('recent-folders', () => recentFolders())
ipcMain.handle('forget-folder', (_e, dir: string) => forget(dir))
// On launch: a folder the app was started with (from the taskbar's recent folders), else the last.
const launchFolder = folderArg(process.argv)
ipcMain.handle('last-folder', async () => {
  if (launchFolder) return launchFolder
  const { lastFolder } = await readState()
  if (!lastFolder) return null
  return fs.stat(lastFolder).then(
    (s) => (s.isDirectory() ? lastFolder : null),
    () => null
  )
})
ipcMain.handle('save-project', (_e, dir: string, project: ProjectFile, force?: boolean) => saveProject(dir, project, force))
ipcMain.handle('read-project', (_e, dir: string) => readProject(dir))
ipcMain.handle('restore-project', (_e, dir: string) => restoreProject(dir))
ipcMain.handle('choose-export-dir', async (_e, defaultPath?: string) => {
  const res = await dialog.showOpenDialog(win!, { defaultPath, properties: ['openDirectory', 'createDirectory'] })
  return res.canceled ? null : (res.filePaths[0] ?? null)
})
ipcMain.handle('write-file', async (_e, path: string, data: ArrayBuffer) => {
  if (!inOutput(path)) throw new Error('Not in the export folder')
  await fs.mkdir(dirname(path), { recursive: true })
  await fs.writeFile(path, Buffer.from(data))
})
ipcMain.handle('export-video', async (e, job: VideoExportJob) => {
  mustRead(job.input)
  if (!inOutput(job.output)) throw new Error('Not in the export folder')
  await fs.mkdir(dirname(job.output), { recursive: true })
  await exportVideo(job, (progress) => e.sender.send('export-progress', { id: job.id, progress }))
})
ipcMain.handle('export-composition', async (e, job: CompositionExportJob) => {
  job.cells.forEach((c) => mustRead(c.input))
  if (!inOutput(job.output)) throw new Error('Not in the export folder')
  await fs.mkdir(dirname(job.output), { recursive: true })
  await exportComposition(job, (progress) => e.sender.send('export-progress', { id: job.id, progress }))
})
ipcMain.handle('cancel-export', () => cancelExport())
ipcMain.handle('poster', (_e, path: string) => {
  mustRead(path)
  return poster(path)
})
ipcMain.handle('hash-files', (_e, paths: string[]) =>
  Promise.all(paths.map((p) => (canRead(p) ? fs.stat(p).then((st) => contentHash(p, st)) : Promise.reject()).catch(() => null)))
)
ipcMain.handle('frame', (_e, path: string, time: number, color?: ColorMeta, tag?: string, edge?: number) => {
  mustRead(path)
  return frame(path, time, color, tag, edge)
})
ipcMain.handle(
  'copy',
  async (
    e,
    id: number,
    path: string,
    w: number,
    h: number,
    color: ColorMeta | undefined,
    edge: number,
    duration: number,
    background: boolean,
    stream: boolean
  ) => {
    mustRead(path)
    const out = await copy(id, path, w, h, color, edge, duration, background, stream, (progress, live) => {
      // A copy streamed while it's made: readable from the moment it exists.
      if (live) copiesOut.add(normalize(live))
      e.sender.send('copy-progress', { id, progress, stream: live })
    })
    if (out) copiesOut.add(normalize(out))
    return out
  }
)
ipcMain.handle('copies-made', async (_e, list: { path: string; edge: number }[]) => {
  const ok = list.map((c) => readable.has(normalize(c.path)))
  const found = await copiesMade(list.filter((_, i) => ok[i]))
  let i = 0
  return ok.map((yes) => {
    const out = yes ? found[i++] : null
    if (out) copiesOut.add(normalize(out))
    return out
  })
})
ipcMain.handle('cancel-copy', (_e, id?: number) => cancelCopy(id))
ipcMain.handle('cache-size', () => cacheSize())
ipcMain.handle('clear-cache', () => clearCache())
// Export progress on the taskbar / Dock icon (-1 clears it).
ipcMain.handle('set-progress', (e, p: number) => BrowserWindow.fromWebContents(e.sender)?.setProgressBar(p < 0 ? -1 : p))
// Windows / Linux draw the caption buttons over the page (titleBarOverlay), so a modal's backdrop
// can't dim them. Fade their colours alongside the backdrop instead (it's 55% black over BG), on
// the same 180ms ease-out-cubic as the backdrop's CSS animation so the two move together.
const OVERLAY = { color: [0x11, 0x11, 0x13], symbol: [0x8b, 0x8b, 0x93] }
type Rgb = number[]
const scale = (c: Rgb, k: number) => c.map((v) => v * k)
const TINTS: Record<OverlayTint, { color: Rgb; symbol: Rgb }> = {
  none: OVERLAY,
  dim: { color: scale(OVERLAY.color, 0.45), symbol: scale(OVERLAY.symbol, 0.45) }
}
let overlayNow = OVERLAY
let overlayFade: NodeJS.Timeout | undefined
// Eases from whatever the controls show now.
ipcMain.handle('set-overlay-tint', (e, tint: OverlayTint) => {
  const w = BrowserWindow.fromWebContents(e.sender)
  const to = TINTS[tint]
  if (!w || !to || process.platform === 'darwin') return
  clearInterval(overlayFade)
  const hex = (c: Rgb) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')
  const from = overlayNow
  const t0 = Date.now()
  overlayFade = setInterval(() => {
    const t = Math.min(1, (Date.now() - t0) / 180)
    const k = 1 - Math.pow(1 - t, 3)
    const mix = (a: Rgb, b: Rgb) => a.map((v, i) => v + (b[i] - v) * k)
    overlayNow = { color: mix(from.color, to.color), symbol: mix(from.symbol, to.symbol) }
    try {
      w.setTitleBarOverlay({ color: hex(overlayNow.color), symbolColor: hex(overlayNow.symbol) })
    } catch {
      // No overlay (e.g. frameless without one); nothing to tint.
    }
    if (t === 1) clearInterval(overlayFade)
  }, 16)
})
ipcMain.handle('focus-window', (e) => {
  const w = BrowserWindow.fromWebContents(e.sender)
  if (w?.isMinimized()) w.restore()
  w?.focus()
})
// Finding a newer release also starts the installed app downloading it in the background.
ipcMain.handle('check-update', async (e) => {
  const update = await checkForUpdate()
  const w = BrowserWindow.fromWebContents(e.sender)
  if (update && w) pollAutoUpdate(w)
  return update && { ...update, status: updateStatus() }
})
ipcMain.handle('install-update', () => installUpdate())
ipcMain.handle('open-release', () => openRelease())
// Only things Reframe shows: the open folder and what's in it, and where exports went.
ipcMain.handle('reveal', async (_e, path: string) => {
  const p = normalize(path)
  if (!(currentDir && (p === currentDir || within(currentDir, p))) && !outputRoots.has(p) && !inOutput(p)) return
  const st = await fs.stat(p).catch(() => null)
  if (st?.isDirectory()) await shell.openPath(p)
  else shell.showItemInFolder(p)
})

// A second launch focuses this window, opening the folder it was given (a jump list entry).
app.on('second-instance', (_e, argv) => {
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.focus()
  const dir = folderArg(argv)
  if (dir) win.webContents.send('open-folder-request', dir)
})

app.whenReady().then(() => {
  if (!primary) return
  clearOldProxies().catch(() => {})
  protocol.handle('media', serveMedia)
  setMenu()
  createWindow()
  updateSystemMenus((dir) => win?.webContents.send('open-folder-request', dir))
})

app.on('window-all-closed', () => app.quit())

// However the app quits (window closed, ⌘Q, restarting into an update), stop the media worker
// first: it kills any running ffmpeg and removes half-written exports and copies.
let stopped = false
app.on('before-quit', (e) => {
  if (stopped) return
  e.preventDefault()
  stopWorker().finally(() => {
    stopped = true
    app.quit()
  })
})
