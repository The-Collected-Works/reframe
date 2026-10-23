import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app, type BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { UpdateStatus } from '@shared/types'

/**
 * Self-updating is for the installed Windows app only. The portable zip has nothing to update in
 * place, and macOS only lets signed apps replace themselves; both keep the download link instead.
 * The installer leaves its uninstaller beside the exe, which the zip doesn't have.
 */
export function canAutoUpdate(): boolean {
  if (!app.isPackaged || process.platform !== 'win32') return false
  return existsSync(join(dirname(process.execPath), 'Uninstall Reframe.exe'))
}

let status: UpdateStatus = { state: 'idle' }
let listening = false
let target: BrowserWindow | null = null

function set(next: UpdateStatus): void {
  status = next
  if (target && !target.isDestroyed()) target.webContents.send('update-status', status)
}

export const updateStatus = (): UpdateStatus => status

/**
 * Downloads the newest release in the background (only the changed blocks, when it can), then
 * waits: it installs when the app quits, or straight away from "Restart to update". Any failure
 * (no update manifest on the release, offline, disk) leaves the plain download link in place.
 */
export function pollAutoUpdate(win: BrowserWindow): void {
  target = win
  if (!canAutoUpdate() || status.state === 'downloading' || status.state === 'ready') return
  if (!listening) listen()
  autoUpdater.checkForUpdates().catch(() => set({ state: 'failed' }))
}

function listen(): void {
  listening = true
  autoUpdater.logger = null
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('update-available', (info) => set({ state: 'downloading', version: info.version, percent: 0 }))
  autoUpdater.on('download-progress', (p) => {
    if (status.state === 'downloading') set({ ...status, percent: Math.round(p.percent) })
  })
  autoUpdater.on('update-downloaded', (info) => set({ state: 'ready', version: info.version }))
  autoUpdater.on('error', () => set({ state: 'failed' }))
}

/** Quits and runs the downloaded installer silently, then reopens the app. */
export function installUpdate(): void {
  if (status.state === 'ready') autoUpdater.quitAndInstall(true, true)
}
