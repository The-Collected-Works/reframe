import { spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { inColor, parseColor } from '@shared/color'
import { videoArgs } from '@shared/filtergraph'
import { posterTime } from '@shared/media'
import type { ColorMeta, PosterResult, VideoExportJob } from '@shared/types'

// Runs inside the media worker (see worker.ts); the main process passes these in.
const FFMPEG = process.env.REFRAME_FFMPEG_BIN || 'ffmpeg'
const CACHE = process.env.REFRAME_CACHE_DIR || ''

function run(args: string[], onStdout?: (chunk: string) => void): { proc: ChildProcess; done: Promise<{ code: number; stdout: Buffer; stderr: string }> } {
  const proc = spawn(FFMPEG, args, { windowsHide: true })
  const out: Buffer[] = []
  let stderr = ''
  proc.stdout!.on('data', (d: Buffer) => {
    out.push(d)
    onStdout?.(d.toString())
  })
  proc.stderr!.on('data', (d: Buffer) => {
    stderr = (stderr + d.toString()).slice(-20000)
  })
  const done = new Promise<{ code: number; stdout: Buffer; stderr: string }>((resolve, reject) => {
    proc.on('error', reject)
    proc.on('close', (code) => resolve({ code: code ?? -1, stdout: Buffer.concat(out), stderr }))
  })
  return { proc, done }
}

let current: { proc: ChildProcess; output: string } | null = null
let cancelled = false

export async function exportVideo(job: VideoExportJob, onProgress: (p: number) => void): Promise<void> {
  cancelled = false
  const total = Math.max(0.01, (job.clip.end ?? job.duration) - job.clip.start)
  const { proc, done } = run(videoArgs(job), (chunk) => {
    const m = [...chunk.matchAll(/out_time_us=(\d+)/g)].pop()
    if (m) onProgress(Math.min(1, Number(m[1]) / 1e6 / total))
  })
  current = { proc, output: job.output }
  const res = await done
  current = null
  if (cancelled) {
    await fs.rm(job.output, { force: true })
    throw new Error('cancelled')
  }
  if (res.code !== 0) {
    await fs.rm(job.output, { force: true })
    const lines = res.stderr.trim().split('\n')
    throw new Error(lines.slice(-3).join(' ').slice(0, 400) || `ffmpeg exited with ${res.code}`)
  }
  onProgress(1)
}

export function cancelExport(): void {
  cancelled = true
  current?.proc.kill('SIGKILL')
}

function parseDuration(stderr: string): number {
  const m = /Duration:\s*(\d+):(\d+):([\d.]+)/.exec(stderr)
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0
}

/**
 * First meaningful frame (full resolution, rotation and pixel aspect applied), duration and
 * colour metadata. The frame goes through RGB using the source's own matrix and range, so the
 * JPEG shows the same colours as the video rather than a BT.601 misreading of BT.709 data.
 */
export async function poster(path: string): Promise<PosterResult> {
  const st = await fs.stat(path)
  const key = createHash('sha1').update(`v2|${path}|${st.size}|${st.mtimeMs}`).digest('hex')
  const dir = CACHE
  const jpg = join(dir, key + '.jpg')
  const meta = join(dir, key + '.json')
  try {
    const [data, info] = await Promise.all([fs.readFile(jpg), fs.readFile(meta, 'utf8')])
    const { duration, color } = JSON.parse(info)
    if (color) return { data, duration, color }
  } catch {
    // not cached
  }

  const probe = await run(['-hide_banner', '-i', path]).done
  const duration = parseDuration(probe.stderr)
  const color = parseColor(probe.stderr)
  const grab = (t: number) =>
    run([
      '-hide_banner', '-loglevel', 'error',
      '-ss', t.toFixed(3), '-i', path,
      '-frames:v', '1', '-vf', `scale=iw*sar:ih:${inColor(color)},format=rgb24,setsar=1`,
      '-f', 'image2pipe', '-c:v', 'mjpeg', '-q:v', '3', 'pipe:1'
    ]).done
  let res = await grab(posterTime(duration))
  if (!res.stdout.length) res = await grab(0)
  if (!res.stdout.length) throw new Error('Could not read video')

  await fs.mkdir(dir, { recursive: true })
  await Promise.all([fs.writeFile(jpg, res.stdout), fs.writeFile(meta, JSON.stringify({ duration, color }))]).catch(() => {})
  return { data: res.stdout, duration, color }
}

/** One frame as JPEG, decoded with the source's colour metadata (what export sees). */
export async function frame(path: string, time: number, color?: ColorMeta): Promise<Buffer> {
  const res = await run([
    '-hide_banner', '-loglevel', 'error',
    '-ss', Math.max(0, time).toFixed(3), '-i', path,
    '-frames:v', '1', '-vf', `scale=iw*sar:ih:${inColor(color)},format=rgb24,setsar=1`,
    '-f', 'image2pipe', '-c:v', 'mjpeg', '-q:v', '2', 'pipe:1'
  ]).done
  if (!res.stdout.length) throw new Error('Could not read frame')
  return res.stdout
}
