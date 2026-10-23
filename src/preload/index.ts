import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { ExportProgress, ReframeApi, UpdateStatus } from '@shared/types'

function listen<T>(channel: string, cb: (payload: T) => void): () => void {
  const fn = (_e: unknown, payload: T) => cb(payload)
  ipcRenderer.on(channel, fn)
  return () => ipcRenderer.removeListener(channel, fn)
}

const api: ReframeApi = {
  platform: process.platform,
  openFolder: () => ipcRenderer.invoke('open-folder'),
  scanFolder: (dir) => ipcRenderer.invoke('scan-folder', dir),
  lastFolder: () => ipcRenderer.invoke('last-folder'),
  saveProject: (dir, project) => ipcRenderer.invoke('save-project', dir, project),
  chooseExportDir: (defaultPath) => ipcRenderer.invoke('choose-export-dir', defaultPath),
  writeFile: (path, data) => ipcRenderer.invoke('write-file', path, data),
  exportVideo: (job) => ipcRenderer.invoke('export-video', job),
  cancelExport: () => ipcRenderer.invoke('cancel-export'),
  poster: (path) => ipcRenderer.invoke('poster', path),
  frame: (path, time, color) => ipcRenderer.invoke('frame', path, time, color),
  scrubProxy: (path, w, h, color) => ipcRenderer.invoke('scrub-proxy', path, w, h, color),
  reveal: (path) => ipcRenderer.invoke('reveal', path),
  checkUpdate: () => ipcRenderer.invoke('check-update'),
  onUpdateStatus: (cb) => listen<UpdateStatus>('update-status', cb),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  setProgress: (p) => ipcRenderer.invoke('set-progress', p),
  focusWindow: () => ipcRenderer.invoke('focus-window'),
  setDimmed: (dimmed) => ipcRenderer.invoke('set-dimmed', dimmed),
  openRelease: () => ipcRenderer.invoke('open-release'),
  pathForFile: (file) => webUtils.getPathForFile(file),
  onExportProgress: (cb) => listen<ExportProgress>('export-progress', cb),
  onFolderChanged: (cb) => listen<void>('folder-changed', cb),
  onWindowMoving: (cb) => listen<void>('window-moving', cb)
}

contextBridge.exposeInMainWorld('reframe', api)
