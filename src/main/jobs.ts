import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app, utilityProcess, type UtilityProcess } from 'electron'
import type { ColorMeta, PosterResult, VideoExportJob } from '@shared/types'
import type { WorkerReply, WorkerRequest } from './worker'

const OS: Record<string, string> = { win32: 'win', darwin: 'mac', linux: 'linux' }

/**
 * Bundled binary when packaged. In dev: REFRAME_FFMPEG (set by dev:win to a copy on the Windows
 * drive), ffmpeg-static, or vendor/. Otherwise whatever is on PATH.
 */
function ffmpegPath(): string {
  const exe = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
  const root = app.getAppPath()
  const candidates = app.isPackaged
    ? [join(process.resourcesPath, 'ffmpeg', exe)]
    : [
        process.env.REFRAME_FFMPEG ?? '',
        join(root, 'node_modules', 'ffmpeg-static', exe),
        join(root, 'vendor', 'ffmpeg', `${OS[process.platform]}-${process.arch}`, exe)
      ]
  return candidates.find((p) => p && existsSync(p)) ?? 'ffmpeg'
}

/** Where posters and scrub proxies are cached (the worker writes them; media serves proxies). */
export const cacheDir = (): string => join(app.getPath('userData'), 'posters')

let worker: UtilityProcess | null = null
let nextId = 1
const calls = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; progress?: (p: number) => void }>()

function ensureWorker(): UtilityProcess {
  if (worker) return worker
  const w = utilityProcess.fork(join(__dirname, 'worker.js'), [], {
    serviceName: 'Reframe media',
    env: { ...process.env, REFRAME_FFMPEG_BIN: ffmpegPath(), REFRAME_CACHE_DIR: cacheDir() }
  })
  w.on('message', (m: WorkerReply) => {
    const call = calls.get(m.id)
    if (!call) return
    if ('progress' in m) return call.progress?.(m.progress)
    calls.delete(m.id)
    if ('error' in m) call.reject(new Error(m.error))
    else call.resolve(m.result)
  })
  w.on('exit', () => {
    worker = null
    for (const call of calls.values()) call.reject(new Error('Media worker stopped'))
    calls.clear()
  })
  return (worker = w)
}

/** A request as sent (the id is added here). */
type Request = WorkerRequest extends infer R ? (R extends { id: number } ? Omit<R, 'id'> : never) : never

function call<T>(msg: Request, progress?: (p: number) => void): Promise<T> {
  const id = nextId++
  return new Promise<T>((resolve, reject) => {
    calls.set(id, { resolve: resolve as (v: unknown) => void, reject, progress })
    ensureWorker().postMessage({ ...msg, id })
  })
}

export const poster = (path: string) => call<PosterResult>({ type: 'poster', path })
export const frame = (path: string, time: number, color?: ColorMeta) => call<Uint8Array>({ type: 'frame', path, time, color })
export const scrubProxy = (path: string, w: number, h: number, color?: ColorMeta) => call<string>({ type: 'proxy', path, w, h, color })
export const exportVideo = (job: VideoExportJob, onProgress: (p: number) => void) =>
  call<void>({ type: 'export', job }, onProgress)
export const cancelExport = (): void => worker?.postMessage({ type: 'cancel' } satisfies WorkerRequest)

/**
 * Asks the worker to stop every ffmpeg and remove half-written files, then waits for it to exit
 * (killing it after a second if it hasn't).
 */
export function stopWorker(): Promise<void> {
  const w = worker
  if (!w) return Promise.resolve()
  return new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      w.kill()
      resolve()
    }, 1000)
    w.once('exit', () => {
      clearTimeout(timeout)
      resolve()
    })
    w.postMessage({ type: 'shutdown' } satisfies WorkerRequest)
  })
}
