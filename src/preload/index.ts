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
  rescanFolder: () => ipcRenderer.invoke('rescan-folder'),
  excludeFolder: (rel) => ipcRenderer.invoke('exclude-folder', rel),
  includeFolder: (rel) => ipcRenderer.invoke('include-folder', rel),
  markOutput: (dirs) => ipcRenderer.invoke('mark-output', dirs),
  recentFolders: () => ipcRenderer.invoke('recent-folders'),
  forgetFolder: (dir) => ipcRenderer.invoke('forget-folder', dir),
  onOpenFolderRequest: (cb) => listen<string>('open-folder-request', cb),
  saveProject: (dir, project, force) => ipcRenderer.invoke('save-project', dir, project, force),
  readProject: (dir) => ipcRenderer.invoke('read-project', dir),
  restoreProject: (dir) => ipcRenderer.invoke('restore-project', dir),
  chooseExportDir: (defaultPath) => ipcRenderer.invoke('choose-export-dir', defaultPath),
  writeFile: (path, data) => ipcRenderer.invoke('write-file', path, data),
  exportVideo: (job) => ipcRenderer.invoke('export-video', job),
  exportComposition: (job) => ipcRenderer.invoke('export-composition', job),
  cancelExport: () => ipcRenderer.invoke('cancel-export'),
  poster: (path) => ipcRenderer.invoke('poster', path),
  hashFiles: (paths) => ipcRenderer.invoke('hash-files', paths),
  frame: (path, time, color, tag, edge) => ipcRenderer.invoke('frame', path, time, color, tag, edge),
  copy: (id, path, w, h, color, edge, duration, background, stream) => ipcRenderer.invoke('copy', id, path, w, h, color, edge, duration, background, stream),
  copiesMade: (list) => ipcRenderer.invoke('copies-made', list),
  cancelCopy: (id) => ipcRenderer.invoke('cancel-copy', id),
  cacheSize: () => ipcRenderer.invoke('cache-size'),
  clearCache: () => ipcRenderer.invoke('clear-cache'),
  onCopyProgress: (cb) => listen<{ id: number; progress: number; stream?: string }>('copy-progress', cb),
  reveal: (path) => ipcRenderer.invoke('reveal', path),
  checkUpdate: () => ipcRenderer.invoke('check-update'),
  onUpdateStatus: (cb) => listen<UpdateStatus>('update-status', cb),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  setProgress: (p) => ipcRenderer.invoke('set-progress', p),
  focusWindow: () => ipcRenderer.invoke('focus-window'),
  setOverlayTint: (tint) => ipcRenderer.invoke('set-overlay-tint', tint),
  openRelease: () => ipcRenderer.invoke('open-release'),
  pathForFile: (file) => webUtils.getPathForFile(file),
  onExportProgress: (cb) => listen<ExportProgress>('export-progress', cb),
  onFolderChanged: (cb) => listen<void>('folder-changed', cb),
  onWindowMoving: (cb) => listen<void>('window-moving', cb)
}

contextBridge.exposeInMainWorld('reframe', api)
