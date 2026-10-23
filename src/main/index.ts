import { createReadStream, promises as fs } from 'node:fs'
import { dirname, extname, join, normalize } from 'node:path'
import { Readable } from 'node:stream'
import { app, BrowserWindow, dialog, ipcMain, Menu, protocol, shell } from 'electron'
import type { ColorMeta, OverlayTint, ProjectFile, VideoExportJob } from '@shared/types'
import { cancelExport, exportVideo, frame, poster, scrubProxy, stopWorker } from './jobs'
import { saveProject, scanFolder, watchFolder } from './folder'
import { installUpdate, pollAutoUpdate, updateStatus } from './autoupdate'
import { folderArg, forget, readState, recentFolders, remember, updateSystemMenus } from './recent'
import { checkForUpdate, openRelease } from './updates'

protocol.registerSchemesAsPrivileged([
  { scheme: 'media', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }
])

const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
  '.gif': 'image/gif', '.avif': 'image/avif', '.bmp': 'image/bmp',
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm',
  '.mkv': 'video/x-matroska', '.avi': 'video/x-msvideo'
}

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

async function open(path: string) {
  const dir = (await fs.stat(path)).isDirectory() ? path : dirname(path)
  const scan = await scanFolder(dir)
  currentDir = normalize(dir)
  watchFolder(dir, () => win?.webContents.send('folder-changed'))
  await remember(dir)
  return scan
}

function serveMedia(req: Request): Promise<Response> | Response {
  const path = normalize(decodeURIComponent(new URL(req.url).pathname.slice(1)))
  // The open folder, plus the scrub proxies made from it.
  const allowed = (currentDir && dirname(path) === currentDir) || dirname(path) === normalize(join(app.getPath('userData'), 'posters', 'scrub'))
  if (!allowed) return new Response(null, { status: 403 })
  return fs.stat(path).then(
    (st) => {
      const headers: Record<string, string> = {
        'Content-Type': MIME[extname(path).toLowerCase()] ?? 'application/octet-stream',
        'Accept-Ranges': 'bytes',
        'Access-Control-Allow-Origin': '*'
      }
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
ipcMain.handle('recent-folders', () => recentFolders())
ipcMain.handle('forget-folder', (_e, dir: string) => forget(dir))
// On launch: a folder the app was started with (from the taskbar's recent folders), else the last.
const launchFolder = folderArg(process.argv)
ipcMain.handle('last-folder', async () => {
  if (launchFolder) return launchFolder
  const { lastFolder } = await readState()
  if (!lastFolder) return null
  return fs.stat(lastFolder).then((s) => (s.isDirectory() ? lastFolder : null), () => null)
})
ipcMain.handle('save-project', (_e, dir: string, project: ProjectFile) => saveProject(dir, project))
ipcMain.handle('choose-export-dir', async (_e, defaultPath?: string) => {
  const res = await dialog.showOpenDialog(win!, { defaultPath, properties: ['openDirectory', 'createDirectory'] })
  return res.canceled ? null : res.filePaths[0] ?? null
})
ipcMain.handle('write-file', async (_e, path: string, data: ArrayBuffer) => {
  await fs.mkdir(dirname(path), { recursive: true })
  await fs.writeFile(path, Buffer.from(data))
})
ipcMain.handle('export-video', async (e, job: VideoExportJob) => {
  await fs.mkdir(dirname(job.output), { recursive: true })
  await exportVideo(job, (progress) => e.sender.send('export-progress', { id: job.id, progress }))
})
ipcMain.handle('cancel-export', () => cancelExport())
ipcMain.handle('poster', (_e, path: string) => poster(path))
const inFolder = (path: string) => {
  if (!currentDir || dirname(normalize(path)) !== currentDir) throw new Error('Not in the open folder')
}
ipcMain.handle('frame', (_e, path: string, time: number, color?: ColorMeta) => {
  inFolder(path)
  return frame(path, time, color)
})
ipcMain.handle('scrub-proxy', (_e, path: string, w: number, h: number, color?: ColorMeta) => {
  inFolder(path)
  return scrubProxy(path, w, h, color)
})
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
ipcMain.handle('reveal', async (_e, path: string) => {
  const st = await fs.stat(path).catch(() => null)
  if (st?.isDirectory()) await shell.openPath(path)
  else shell.showItemInFolder(path)
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
  protocol.handle('media', serveMedia)
  setMenu()
  createWindow()
  updateSystemMenus((dir) => win?.webContents.send('open-folder-request', dir))
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow())
})

app.on('window-all-closed', () => {
  cancelExport()
  stopWorker()
  app.quit()
})
