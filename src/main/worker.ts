// Electron utility process that does all ffmpeg work. Starting a process blocks the calling
// thread (over a second on Windows while Defender scans ffmpeg.exe, or from a network/WSL path);
// in the main process that would freeze the whole window. Here it only delays the result.
import type { ColorMeta, GridExportJob, VideoExportJob } from '@shared/types'
import { cancelExport, exportGrid, exportVideo, frame, poster, scrubProxy, shutdown } from './ffmpeg'

export type WorkerRequest =
  | { id: number; type: 'poster'; path: string }
  | { id: number; type: 'frame'; path: string; time: number; color?: ColorMeta }
  | { id: number; type: 'proxy'; path: string; w: number; h: number; color?: ColorMeta }
  | { id: number; type: 'export'; job: VideoExportJob }
  | { id: number; type: 'grid'; job: GridExportJob }
  | { type: 'cancel' }
  | { type: 'shutdown' }

export type WorkerReply = { id: number; result: unknown } | { id: number; error: string } | { id: number; progress: number }

const port = process.parentPort

port.on('message', async ({ data }) => {
  const req = data as WorkerRequest
  if (req.type === 'cancel') return cancelExport()
  // Stop every ffmpeg and remove half-written files before the app quits.
  if (req.type === 'shutdown') return shutdown().finally(() => process.exit(0))
  const reply = (m: WorkerReply) => port.postMessage(m)
  try {
    if (req.type === 'poster') reply({ id: req.id, result: await poster(req.path) })
    else if (req.type === 'frame') reply({ id: req.id, result: await frame(req.path, req.time, req.color) })
    else if (req.type === 'proxy') reply({ id: req.id, result: await scrubProxy(req.path, req.w, req.h, req.color) })
    else if (req.type === 'grid') {
      await exportGrid(req.job, (progress) => reply({ id: req.id, progress }))
      reply({ id: req.id, result: null })
    } else {
      await exportVideo(req.job, (progress) => reply({ id: req.id, progress }))
      reply({ id: req.id, result: null })
    }
  } catch (e) {
    reply({ id: req.id, error: String((e as Error).message ?? e) })
  }
})
