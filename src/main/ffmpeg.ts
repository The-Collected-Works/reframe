import { spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { constants as os, setPriority } from 'node:os'
import { dirname, join } from 'node:path'
import { inColor, OUT_TAGS, parseColor } from '@shared/color'
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

/** Average frame rate of the first video stream ("29.97 fps"), falling back to its tbr. */
function parseFps(stderr: string): number {
  const line = /Stream #.*Video: .*/.exec(stderr)?.[0] ?? ''
  const m = /([\d.]+)(k?) fps/.exec(line) ?? /([\d.]+)(k?) tbr/.exec(line)
  return m ? Number(m[1]) * (m[2] ? 1000 : 1) : 0
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
    const { duration, color, audio, fps } = JSON.parse(info)
    if (color && typeof audio === 'boolean') {
      if (typeof fps === 'number') return { data, duration, color, audio, fps }
      // Cached before frame rates were recorded: probe again (quick) rather than redo the poster.
      const rate = parseFps((await run(['-hide_banner', '-i', path]).done).stderr)
      await fs.writeFile(meta, JSON.stringify({ duration, color, audio, fps: rate })).catch(() => {})
      return { data, duration, color, audio, fps: rate }
    }
  } catch {
    // not cached
  }

  const probe = await run(['-hide_banner', '-i', path]).done
  const duration = parseDuration(probe.stderr)
  const color = parseColor(probe.stderr)
  const audio = /Stream #.*Audio:/.test(probe.stderr)
  const fps = parseFps(probe.stderr)
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
  await Promise.all([fs.writeFile(jpg, res.stdout), fs.writeFile(meta, JSON.stringify({ duration, color, audio, fps }))]).catch(() => {})
  return { data: res.stdout, duration, color, audio, fps }
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

// Scrub proxies: one built at a time, and a queued request that's been superseded (the user
// moved on to another video) is dropped before it starts.
const proxies = new Map<string, Promise<string>>()
let proxyChain: Promise<unknown> = Promise.resolve()
let wantedProxy = ''
const PROXY_EDGE = 800
const PROXY_KEEP = 30

/**
 * A small copy of a video where every frame is a keyframe, for scrubbing: any frame decodes on
 * its own, so seeking is near-instant however the source was encoded. Converted to BT.709 the way
 * export converts, so it matches the real frame it stands in for. Cached beside the posters.
 */
export async function scrubProxy(path: string, w: number, h: number, color?: ColorMeta): Promise<string> {
  const st = await fs.stat(path)
  const key = createHash('sha1').update(`scrub1|${path}|${st.size}|${st.mtimeMs}`).digest('hex')
  const dir = join(CACHE, 'scrub')
  const out = join(dir, key + '.mp4')
  wantedProxy = out
  const known = proxies.get(out)
  if (known) return known
  const job = (async () => {
    if (await fs.access(out).then(() => true, () => false)) return out
    await (proxyChain = proxyChain.catch(() => {}).then(() => buildProxy(path, out, w, h, color)))
    return out
  })()
  proxies.set(out, job)
  job.catch(() => proxies.delete(out))
  return job
}

async function buildProxy(path: string, out: string, w: number, h: number, color?: ColorMeta): Promise<void> {
  if (wantedProxy !== out) throw new Error('superseded')
  await fs.mkdir(dirname(out), { recursive: true })
  const s = Math.min(1, PROXY_EDGE / Math.max(w, h, 1))
  const even = (n: number) => Math.max(2, Math.round((n * s) / 2) * 2)
  const part = out.replace(/\.mp4$/, '.part.mp4')
  const args = (hw: boolean) => [
    '-hide_banner', '-loglevel', 'error', '-y',
    ...(hw ? ['-hwaccel', 'auto'] : []),
    '-i', path, '-an', '-sn', '-dn', '-fpsmax', '30',
    '-vf', `scale=${even(w)}:${even(h)}:${inColor(color)}:out_color_matrix=bt709:out_range=tv,setsar=1,format=yuv420p`,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'fastdecode', '-crf', '30', '-g', '1',
    ...OUT_TAGS, '-movflags', '+faststart', part
  ]
  const attempt = async (hw: boolean) => {
    const { proc, done } = run(args(hw))
    // Background work: keep it out of the way of the UI and of exports.
    try {
      if (proc.pid) setPriority(proc.pid, os.priority.PRIORITY_BELOW_NORMAL)
    } catch {
      // Not permitted here; run at normal priority.
    }
    return (await done).code === 0
  }
  // Hardware decoding where it works, else software.
  if (!(await attempt(true)) && !(await attempt(false))) {
    await fs.rm(part, { force: true })
    throw new Error('Could not build scrub proxy')
  }
  await fs.rename(part, out)
  await pruneProxies(dirname(out))
}

async function pruneProxies(dir: string): Promise<void> {
  const names = (await fs.readdir(dir).catch(() => [] as string[])).filter((n) => !n.includes('.part.'))
  const files = await Promise.all(names.map(async (n) => ({ p: join(dir, n), t: (await fs.stat(join(dir, n)).catch(() => null))?.mtimeMs ?? 0 })))
  files.sort((a, b) => b.t - a.t)
  await Promise.all(files.slice(PROXY_KEEP).map((f) => fs.rm(f.p, { force: true })))
}
