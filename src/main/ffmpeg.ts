import { spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { promises as fs, type Stats } from 'node:fs'
import { constants as os, setPriority } from 'node:os'
import { join } from 'node:path'
import { inColor, OUT_TAGS, parseColor } from '@shared/color'
import { layoutArgs, videoArgs } from '@shared/filtergraph'
import { posterTime } from '@shared/media'
import type { ColorMeta, LayoutExportJob, PosterResult, VideoExportJob } from '@shared/types'
import { writeJsonAtomic } from './fsutil'

// Runs inside the media worker (see worker.ts); the main process passes these in.
const FFMPEG = process.env.REFRAME_FFMPEG_BIN || 'ffmpeg'
const CACHE = process.env.REFRAME_CACHE_DIR || ''
const SCRUB = join(CACHE, 'scrub')

type Kind = 'probe' | 'poster' | 'frame' | 'proxy' | 'export'
type Result = { code: number; stdout: Buffer; stderr: string }

/**
 * Every ffmpeg this worker has running, by what it's for, so cancelling an export, superseding a
 * frame and shutting down each stop exactly the right ones. Files being written that should go if
 * they're cut short are tracked too.
 */
const running = new Map<ChildProcess, Kind>()
const partFiles = new Set<string>()

/** Runs ffmpeg. Output a caller streams (`onStdout`) isn't also kept in memory. */
function run(kind: Kind, args: string[], onStdout?: (chunk: string) => void): { proc: ChildProcess; done: Promise<Result> } {
  const proc = spawn(FFMPEG, args, { windowsHide: true })
  running.set(proc, kind)
  const out: Buffer[] = []
  let stderr = ''
  proc.stdout!.on('data', (d: Buffer) => (onStdout ? onStdout(d.toString()) : out.push(d)))
  proc.stderr!.on('data', (d: Buffer) => {
    stderr = (stderr + d.toString()).slice(-20000)
  })
  const done = new Promise<Result>((resolve, reject) => {
    proc.on('error', (e) => {
      running.delete(proc)
      reject(e)
    })
    proc.on('close', (code) => {
      running.delete(proc)
      resolve({ code: code ?? -1, stdout: Buffer.concat(out), stderr })
    })
  })
  return { proc, done }
}

const kill = (kind: Kind) => running.forEach((k, p) => k === kind && p.kill('SIGKILL'))

/** Stops everything and removes anything left half-written. */
export async function shutdown(): Promise<void> {
  running.forEach((_, p) => p.kill('SIGKILL'))
  await Promise.all([...partFiles].map((f) => fs.rm(f, { force: true })))
}

// ---------- export ----------

let exportCancelled = false

/**
 * Renders one video. It's written beside the output and renamed into place only once it's
 * complete, so a cancelled or failed export never touches an earlier good file of the same name.
 */
export async function exportVideo(job: VideoExportJob, onProgress: (p: number) => void): Promise<void> {
  exportCancelled = false
  const part = partOf(job.output)
  partFiles.add(part)
  try {
    await encode(videoArgs({ ...job, output: part }), (job.clip.end ?? job.duration) - job.clip.start, onProgress)
    await fs.rename(part, job.output)
    onProgress(1)
  } finally {
    partFiles.delete(part)
    await fs.rm(part, { force: true })
  }
}

const partOf = (output: string) => output.replace(/(\.[^./\\]+)?$/, '.part$1')

/** Runs one export encode of `seconds` of output, reporting progress through it (0..1). */
async function encode(args: string[], seconds: number, onProgress: (p: number) => void): Promise<void> {
  const total = Math.max(0.01, seconds)
  let line = ''
  const { done } = run('export', args, (chunk) => {
    // Progress arrives as key=value lines, which can be split across chunks.
    const lines = (line + chunk).split('\n')
    line = lines.pop() ?? ''
    for (const l of lines) {
      const m = /^out_time_us=(\d+)/.exec(l)
      if (m) onProgress(Math.min(1, Number(m[1]) / 1e6 / total))
    }
  })
  const res = await done
  if (exportCancelled) throw new Error('cancelled')
  if (res.code !== 0) {
    const lines = res.stderr.trim().split('\n')
    throw new Error(lines.slice(-3).join(' ').slice(0, 400) || `ffmpeg exited with ${res.code}`)
  }
}

/**
 * Renders a layout with video in it, in two passes. First each video is framed into a file the size
 * of its cell, exactly as a single video is framed into an artboard (trimmed, so a whole file is
 * one loop). Then those are laid over the background, looping or holding, under the renderer's
 * layer of everything that doesn't move. Working files go once it's done (or cut short).
 */
export async function exportLayout(job: LayoutExportJob, onProgress: (p: number) => void): Promise<void> {
  exportCancelled = false
  const dir = join(CACHE, 'layout')
  await fs.mkdir(dir, { recursive: true })
  const tag = createHash('sha1').update(`${job.output}|${Date.now()}`).digest('hex').slice(0, 12)
  const layer = join(dir, `${tag}-layer.png`)
  const cells = job.cells.map((_, i) => join(dir, `${tag}-cell${i}.mp4`))
  const part = partOf(job.output)
  const working = [layer, ...cells, part]
  working.forEach((f) => partFiles.add(f))
  // Progress: each cell's pass in proportion to its length, then the layout's for its own.
  const total = job.cells.reduce((n, c) => n + c.length, 0) + job.duration
  let before = 0
  const step = (seconds: number) => (p: number) => onProgress((before + p * seconds) / total)
  try {
    await fs.writeFile(layer, job.layer)
    for (const [i, c] of job.cells.entries()) {
      if (exportCancelled) throw new Error('cancelled')
      const cell: VideoExportJob = {
        id: job.id,
        input: c.input,
        output: cells[i],
        width: c.width,
        height: c.height,
        srcWidth: c.srcWidth,
        srcHeight: c.srcHeight,
        color: c.color,
        settings: { ...c.settings, mute: true },
        clip: c.clip,
        duration: c.clip.start + c.length,
        // Nearly lossless: it's encoded again in the second pass.
        crf: 8
      }
      await encode(videoArgs(cell), c.length, step(c.length))
      before += c.length
    }
    if (exportCancelled) throw new Error('cancelled')
    await encode(layoutArgs(job, layer, cells, part), job.duration, step(job.duration))
    await fs.rename(part, job.output)
    onProgress(1)
  } finally {
    working.forEach((f) => partFiles.delete(f))
    await Promise.all(working.map((f) => fs.rm(f, { force: true })))
  }
}

export function cancelExport(): void {
  exportCancelled = true
  kill('export')
}

// ---------- caches ----------

/** Cache file name for a source file as it is now (a changed file gets a new entry). */
const cacheKey = (tag: string, path: string, st: Stats) => createHash('sha1').update(`${tag}|${path}|${st.size}|${st.mtimeMs}`).digest('hex')

/** Marks a cache entry as just used, so pruning keeps what's in use rather than what's newest. */
const touch = (...files: string[]) => {
  const now = new Date()
  return Promise.all(files.map((f) => fs.utimes(f, now, now).catch(() => {})))
}

/** Deletes the least recently used files in `dir` beyond `maxBytes` (and any stray partial files). */
async function prune(dir: string, maxBytes: number): Promise<void> {
  const names = await fs.readdir(dir).catch(() => [] as string[])
  const files = await Promise.all(
    names.map(async (name) => {
      const st = await fs.stat(join(dir, name)).catch(() => null)
      return st?.isFile() ? { path: join(dir, name), name, size: st.size, used: st.mtimeMs } : null
    })
  )
  let total = 0
  const doomed: string[] = []
  for (const f of files.filter((x) => x !== null).sort((a, b) => b.used - a.used)) {
    if (f.name.includes('.part.') && !partFiles.has(f.path)) doomed.push(f.path)
    else if ((total += f.size) > maxBytes) doomed.push(f.path)
  }
  await Promise.all(doomed.map((f) => fs.rm(f, { force: true })))
}

const POSTER_BYTES = 1024 ** 3
const SCRUB_BYTES = 2 * 1024 ** 3
let posterPrune: NodeJS.Timeout | undefined

// ---------- posters and frames ----------

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

/** One frame as JPEG (full resolution, pixel aspect applied), decoded the way export decodes. */
const grabFrame = (kind: Kind, path: string, time: number, color: ColorMeta | undefined, quality: number) =>
  run(kind, [
    '-hide_banner',
    '-loglevel',
    'error',
    '-ss',
    Math.max(0, time).toFixed(3),
    '-i',
    path,
    '-frames:v',
    '1',
    '-vf',
    `scale=iw*sar:ih:${inColor(color)},format=rgb24,setsar=1`,
    '-f',
    'image2pipe',
    '-c:v',
    'mjpeg',
    '-q:v',
    String(quality),
    'pipe:1'
  ]).done

/**
 * First meaningful frame (full resolution, rotation and pixel aspect applied), duration and
 * colour metadata. The frame goes through RGB using the source's own matrix and range, so the
 * JPEG shows the same colours as the video rather than a BT.601 misreading of BT.709 data.
 */
export async function poster(path: string): Promise<PosterResult> {
  const st = await fs.stat(path)
  const key = cacheKey('v3', path, st)
  const jpg = join(CACHE, key + '.jpg')
  const meta = join(CACHE, key + '.json')
  try {
    const [data, info] = await Promise.all([fs.readFile(jpg), fs.readFile(meta, 'utf8')])
    const { duration, color, audio, fps } = JSON.parse(info)
    touch(jpg, meta)
    return { data, duration, color, audio, fps }
  } catch {
    // not cached
  }

  const probe = await run('probe', ['-hide_banner', '-i', path]).done
  const duration = parseDuration(probe.stderr)
  const color = parseColor(probe.stderr)
  const audio = /Stream #.*Audio:/.test(probe.stderr)
  const fps = parseFps(probe.stderr)
  let res = await grabFrame('poster', path, posterTime(duration), color, 3)
  if (!res.stdout.length) res = await grabFrame('poster', path, 0, color, 3)
  if (!res.stdout.length) throw new Error('Could not read video')

  await fs.mkdir(CACHE, { recursive: true })
  await Promise.all([fs.writeFile(jpg, res.stdout), writeJsonAtomic(meta, { duration, color, audio, fps })]).catch(() => {})
  clearTimeout(posterPrune)
  posterPrune = setTimeout(() => prune(CACHE, POSTER_BYTES), 5000)
  return { data: res.stdout, duration, color, audio, fps }
}

/**
 * One frame as JPEG, decoded with the source's colour metadata (what export sees). Only the newest
 * request matters (it's the frame on screen), so a new one stops any still decoding.
 */
export async function frame(path: string, time: number, color?: ColorMeta): Promise<Buffer> {
  kill('frame')
  const res = await grabFrame('frame', path, time, color, 2)
  if (!res.stdout.length) throw new Error('Could not read frame')
  return res.stdout
}

// ---------- scrub proxies ----------

// Built one at a time; a queued request that's been superseded (the user moved on to another
// video) is dropped before it starts. Only builds in progress are remembered: a finished proxy is
// found on disk, so a pruned one is simply built again.
const building = new Map<string, Promise<string>>()
let proxyChain: Promise<unknown> = Promise.resolve()
let wantedProxy = ''
const PROXY_EDGE = 800

/**
 * A small copy of a video where every frame is a keyframe, for scrubbing: any frame decodes on
 * its own, so seeking is near-instant however the source was encoded. Converted to BT.709 the way
 * export converts, so it matches the real frame it stands in for. Cached beside the posters.
 */
export async function scrubProxy(path: string, w: number, h: number, color?: ColorMeta): Promise<string> {
  const out = join(SCRUB, cacheKey('scrub1', path, await fs.stat(path)) + '.mp4')
  wantedProxy = out
  if (
    await fs.access(out).then(
      () => true,
      () => false
    )
  ) {
    touch(out)
    return out
  }
  let job = building.get(out)
  if (!job) {
    job = proxyChain
      .catch(() => {})
      .then(() => buildProxy(path, out, w, h, color))
      .then(() => out)
    proxyChain = job
    building.set(out, job)
    job.finally(() => building.delete(out)).catch(() => {})
  }
  return job
}

async function buildProxy(path: string, out: string, w: number, h: number, color?: ColorMeta): Promise<void> {
  if (wantedProxy !== out) throw new Error('superseded')
  await fs.mkdir(SCRUB, { recursive: true })
  const s = Math.min(1, PROXY_EDGE / Math.max(w, h, 1))
  const even = (n: number) => Math.max(2, Math.round((n * s) / 2) * 2)
  const part = out.replace(/\.mp4$/, '.part.mp4')
  const args = (hw: boolean) => [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    ...(hw ? ['-hwaccel', 'auto'] : []),
    '-i',
    path,
    '-an',
    '-sn',
    '-dn',
    '-fpsmax',
    '30',
    '-vf',
    `scale=${even(w)}:${even(h)}:${inColor(color)}:out_color_matrix=bt709:out_range=tv,setsar=1,format=yuv420p`,
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-tune',
    'fastdecode',
    '-crf',
    '30',
    '-g',
    '1',
    ...OUT_TAGS,
    '-movflags',
    '+faststart',
    part
  ]
  const attempt = async (hw: boolean) => {
    const { proc, done } = run('proxy', args(hw))
    // Background work: keep it out of the way of the UI and of exports.
    try {
      if (proc.pid) setPriority(proc.pid, os.priority.PRIORITY_BELOW_NORMAL)
    } catch {
      // Not permitted here; run at normal priority.
    }
    return (await done).code === 0
  }
  partFiles.add(part)
  try {
    // Hardware decoding where it works, else software.
    if (!(await attempt(true)) && !(await attempt(false))) throw new Error('Could not build scrub proxy')
    await fs.rename(part, out)
  } finally {
    partFiles.delete(part)
    await fs.rm(part, { force: true })
  }
  await prune(SCRUB, SCRUB_BYTES)
}
