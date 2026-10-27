import { spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { promises as fs, type Stats } from 'node:fs'
import { constants as os, setPriority } from 'node:os'
import { join } from 'node:path'
import { inColor, OUT_TAGS, parseColor } from '@shared/media/color'
import { compositionArgs, gifArgs, videoArgs } from '@shared/media/filtergraph'
import type { ColorMeta, CompositionExportJob, GifOptions, PosterResult, VideoExportJob } from '@shared/types'
import { contentHash, writeJsonAtomic } from './fsutil'

// Runs inside the media worker (see worker.ts); the main process passes these in.
const FFMPEG = process.env.REFRAME_FFMPEG_BIN || 'ffmpeg'
const CACHE = process.env.REFRAME_CACHE_DIR || ''

type Kind = 'probe' | 'poster' | 'frame' | 'copy' | 'export'
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
    const quiet = job.gif ? { ...job, settings: { ...job.settings, mute: true } } : job
    await encodeAs(
      job.gif,
      part,
      (out, crf) => videoArgs({ ...quiet, output: out, crf: crf ?? job.crf }),
      (job.clip.end ?? job.duration) - job.clip.start,
      onProgress
    )
    await fs.rename(part, job.output)
    onProgress(1)
  } finally {
    partFiles.delete(part)
    await fs.rm(part, { force: true })
  }
}

const partOf = (output: string) => output.replace(/(\.[^./\\]+)?$/, '.part$1')

/**
 * Encodes `seconds` of output into `part` with `args(output, crf?)`. A GIF is encoded as a nearly
 * lossless MP4 first (so it's framed and composited exactly as one), then made from that.
 */
async function encodeAs(
  gif: GifOptions | undefined,
  part: string,
  args: (output: string, crf?: number) => string[],
  seconds: number,
  onProgress: (p: number) => void
): Promise<void> {
  if (!gif) return encode(args(part), seconds, onProgress)
  const mp4 = part.replace(/\.gif$/, '.mp4')
  partFiles.add(mp4)
  try {
    await encode(args(mp4, 10), seconds, (p) => onProgress(p * 0.7))
    if (exportCancelled) throw new Error('cancelled')
    await encode(gifArgs(mp4, part, gif), seconds, (p) => onProgress(0.7 + p * 0.3))
  } finally {
    partFiles.delete(mp4)
    await fs.rm(mp4, { force: true })
  }
}

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
 * Renders a composition with video in it, in two passes. First each video is framed into a file the size
 * of its cell, exactly as a single video is framed into an artboard (trimmed, so a whole file is
 * one loop). Then those are laid over the background, looping or holding, under the renderer's
 * layer of everything that doesn't move. Working files go once it's done (or cut short).
 */
export async function exportComposition(job: CompositionExportJob, onProgress: (p: number) => void): Promise<void> {
  exportCancelled = false
  const dir = join(CACHE, 'composition')
  await fs.mkdir(dir, { recursive: true })
  const tag = createHash('sha1').update(`${job.output}|${Date.now()}`).digest('hex').slice(0, 12)
  const layer = join(dir, `${tag}-layer.png`)
  const cells = job.cells.map((_, i) => join(dir, `${tag}-cell${i}.mp4`))
  const part = partOf(job.output)
  const working = [layer, ...cells, part]
  working.forEach((f) => partFiles.add(f))
  // Progress: each cell's pass in proportion to its length, then the composition's for its own.
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
    await encodeAs(job.gif, part, (out, crf) => compositionArgs({ ...job, crf: crf ?? job.crf }, layer, cells, out), job.duration, step(job.duration))
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

const exists = (f: string) =>
  fs.access(f).then(
    () => true,
    () => false
  )

/** Cache file name for a source file by where it is, as it was keyed until 0.6 (see `contentKey`). */
const cacheKey = (tag: string, path: string, st: Stats) => createHash('sha1').update(`${tag}|${path}|${st.size}|${st.mtimeMs}`).digest('hex')

/**
 * Cache file name for a source file by what's in it, not where it is (see `contentHash`). Moved,
 * renamed or reorganised by a sync service, a file keeps its cache entries; edited, it gets new ones.
 */
async function contentKey(tag: string, path: string, st: Stats): Promise<string> {
  const key = await contentHash(path, st)
  return createHash('sha1').update(`${tag}|${key}`).digest('hex')
}

/**
 * `files` as they're named now, taking over any made under the old keys (by where the source was):
 * a cache from before 0.6 isn't made again. Renamed only if the new names are all free.
 */
async function adopt(files: string[], old: string[]): Promise<void> {
  if (await exists(files[0])) return
  if (!(await Promise.all(old.map(exists))).every(Boolean)) return
  await Promise.all(old.map((f, i) => fs.rename(f, files[i]))).catch(() => {})
}

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
    if ((f.name.includes('.part.') || f.name.includes('.stream.')) && !partFiles.has(f.path)) doomed.push(f.path)
    else if ((total += f.size) > maxBytes) doomed.push(f.path)
  }
  await Promise.all(doomed.map((f) => fs.rm(f, { force: true })))
}

const POSTER_BYTES = 1024 ** 3
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

/**
 * One frame as JPEG (pixel aspect applied), decoded the way export decodes: full resolution, or
 * no bigger than `edge` on its long side.
 */
const grabFrame = (kind: Kind, path: string, time: number, color: ColorMeta | undefined, quality: number, edge?: number) =>
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
    `scale=iw*sar:ih:${inColor(color)},${edge ? `scale=${edge}:${edge}:force_original_aspect_ratio=decrease:flags=lanczos,` : ''}format=rgb24,setsar=1`,
    '-f',
    'image2pipe',
    '-c:v',
    'mjpeg',
    '-q:v',
    String(quality),
    'pipe:1'
  ])

/**
 * First frame (full resolution, rotation and pixel aspect applied), duration and
 * colour metadata. The frame goes through RGB using the source's own matrix and range, so the
 * JPEG shows the same colours as the video rather than a BT.601 misreading of BT.709 data.
 */
export async function poster(path: string): Promise<PosterResult> {
  const st = await fs.stat(path)
  const key = await contentKey('poster1', path, st)
  const jpg = join(CACHE, key + '.jpg')
  const meta = join(CACHE, key + '.json')
  const old = cacheKey('v4', path, st)
  await adopt([jpg, meta], [join(CACHE, old + '.jpg'), join(CACHE, old + '.json')])
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
  // The first frame: what playback starts on, so the thumbnail never jumps to another one.
  const res = await grabFrame('poster', path, 0, color, 3).done
  if (!res.stdout.length) throw new Error('Could not read video')

  await fs.mkdir(CACHE, { recursive: true })
  await Promise.all([fs.writeFile(jpg, res.stdout), writeJsonAtomic(meta, { duration, color, audio, fps })]).catch(() => {})
  clearTimeout(posterPrune)
  posterPrune = setTimeout(() => prune(CACHE, POSTER_BYTES), 5000)
  return { data: res.stdout, duration, color, audio, fps }
}

/** Frames being decoded, by who asked: a newer request from the same one stops the older. */
const framing = new Map<string, ChildProcess>()

/**
 * One frame as JPEG, decoded with the source's colour metadata (what export sees), no bigger than
 * `edge` if given. Only the newest request from each `tag` matters (it's the frame on screen
 * there), so a new one stops that tag's previous one still decoding; the stopped one is answered
 * with null.
 */
export async function frame(path: string, time: number, color?: ColorMeta, tag = '', edge?: number): Promise<Buffer | null> {
  framing.get(tag)?.kill('SIGKILL')
  const { proc, done } = grabFrame('frame', path, time, color, 2, edge)
  framing.set(tag, proc)
  const res = await done.finally(() => framing.get(tag) === proc && framing.delete(tag))
  if (proc.killed) return null
  if (!res.stdout.length) throw new Error('Could not read frame')
  return res.stdout
}

// ---------- playback copies ----------

const COPIES = join(CACHE, 'copies')
const COPY_BYTES = 8 * 1024 ** 3
// The renderer decides how many are made at once and in what order, and stops one that something
// more urgent needs the machine for (see cancelCopy). Each is known by the renderer's id for it.
const copying = new Map<string, Promise<string>>()
const copyProcs = new Map<number, ChildProcess>()
const cancelled = new Set<number>()

/** Where a copy of `path` at `edge` lives (taking over one made under its old name). */
async function copyPath(path: string, edge: number): Promise<string> {
  const st = await fs.stat(path)
  const out = join(COPIES, `${await contentKey('copy2', path, st)}-${edge}.mp4`)
  await adopt([out], [join(COPIES, `${cacheKey('copy1', path, st)}-${edge}.mp4`)])
  return out
}

/**
 * Which of these copies are made already (path, or null), without making any: kept between
 * sessions, so a folder opened again plays at once.
 */
export async function copiesMade(list: { path: string; edge: number }[]): Promise<(string | null)[]> {
  return Promise.all(
    list.map(async ({ path, edge }) => {
      const out = await copyPath(path, edge).catch(() => null)
      if (!out || !(await exists(out))) return null
      touch(out)
      return out
    })
  )
}

/**
 * A copy of a video for playing and scrubbing in the app, `edge` pixels on its long side. Every
 * frame is a keyframe, so any frame decodes on its own: seeking is instant, however the source was
 * encoded, and several play at once where several 4K originals can't. The source's frame rate (up
 * to 60), sharp scaling and generous quality: these are for looking at. Converted to BT.709 the way
 * export converts, so it matches the real frame it stands in for. Kept (up to 8 GB, the least
 * recently used going first). `background`: made at low priority, so the app stays responsive.
 */
export async function copy(
  id: number,
  path: string,
  w: number,
  h: number,
  color: ColorMeta | undefined,
  edge: number,
  duration: number,
  background: boolean,
  stream: boolean,
  onProgress: (p: number, stream?: string) => void
): Promise<string | null> {
  const out = await copyPath(path, edge)
  if (await exists(out)) {
    touch(out)
    return out
  }
  let job = copying.get(out)
  if (!job) {
    job = buildCopy(id, path, out, w, h, color, edge, duration, background, stream, onProgress).then(() => out)
    copying.set(out, job)
    job.finally(() => copying.delete(out)).catch(() => {})
  }
  // Stopped for something more urgent: not an error, just not made (yet).
  return job.catch((e) => {
    if (String((e as Error).message) === 'cancelled') return null
    throw e
  })
}

/** What the caches hold (posters and playback copies), in bytes. */
export async function cacheSize(): Promise<number> {
  const sizeOf = async (dir: string): Promise<number> => {
    const names = await fs.readdir(dir).catch(() => [] as string[])
    const sizes = await Promise.all(
      names.map((n) =>
        fs.stat(join(dir, n)).then(
          (st) => (st.isFile() ? st.size : 0),
          () => 0
        )
      )
    )
    return sizes.reduce((a, b) => a + b, 0)
  }
  return (await sizeOf(CACHE)) + (await sizeOf(COPIES))
}

/**
 * Empties the caches: stops the copy being made, then removes every playback copy and poster (what's
 * in use right now may stay until it's let go). Returns how many bytes went.
 */
export async function clearCache(): Promise<number> {
  const before = await cacheSize()
  cancelCopy()
  await Promise.allSettled([...copying.values()])
  await fs.rm(COPIES, { recursive: true, force: true }).catch(() => {})
  const names = await fs.readdir(CACHE).catch(() => [] as string[])
  await Promise.all(names.map((n) => fs.rm(join(CACHE, n), { force: true }).catch(() => {})))
  return before - (await cacheSize())
}

/**
 * Stops copy `id` (something more urgent needs the machine), or with no id every copy being made;
 * its request gives null.
 */
export function cancelCopy(id?: number): void {
  for (const [i, proc] of copyProcs) {
    if (id !== undefined && i !== id) continue
    cancelled.add(i)
    proc.kill('SIGKILL')
  }
  if (id !== undefined) cancelled.add(id)
}

async function buildCopy(
  id: number,
  path: string,
  out: string,
  w: number,
  h: number,
  color: ColorMeta | undefined,
  edge: number,
  duration: number,
  background: boolean,
  stream: boolean,
  onProgress: (p: number, stream?: string) => void
): Promise<void> {
  await fs.mkdir(COPIES, { recursive: true })
  const s = Math.min(1, edge / Math.max(w, h, 1))
  const even = (n: number) => Math.max(2, Math.round((n * s) / 2) * 2)
  const part = out.replace(/\.mp4$/, '.part.mp4')
  // Streaming, the same encode is also written as a fragmented MP4 (a quarter second a fragment),
  // which can be played while it's still being written: the renderer feeds its fragments to a
  // MediaSource as they land. The finished copy is the ordinary file.
  // Each attempt streams to a file of its own: a retry starts over, and so does whatever plays it.
  const liveOf = (hw: boolean) => (stream ? out.replace(/\.mp4$/, hw ? '.stream.mp4' : '.stream-sw.mp4') : null)
  let live = null as string | null
  // The tee muxer's own syntax: forward slashes, and its separators escaped.
  const teePath = (p: string) => p.replace(/\\/g, '/').replace(/([|[\]'])/g, '\\$1')
  const output = (lv: string | null) =>
    lv
      ? [
          '-flags',
          '+global_header',
          '-f',
          'tee',
          `[f=mp4:movflags=empty_moov+default_base_moof:frag_duration=250000]${teePath(lv)}|[f=mp4:movflags=+faststart]${teePath(part)}`
        ]
      : ['-movflags', '+faststart', part]
  const args = (hw: boolean) => [
    '-hide_banner',
    '-loglevel',
    'error',
    '-nostats',
    '-progress',
    'pipe:1',
    '-y',
    ...(hw ? ['-hwaccel', 'auto'] : []),
    '-i',
    path,
    '-map',
    '0:v:0',
    '-an',
    '-sn',
    '-dn',
    '-fpsmax',
    '60',
    '-vf',
    `scale=${even(w)}:${even(h)}:flags=lanczos:${inColor(color)}:out_color_matrix=bt709:out_range=tv,setsar=1,format=yuv420p`,
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '20',
    '-g',
    '1',
    // Fixed, so a stream's codec is known before it starts (see the renderer's StreamFeed).
    '-profile:v',
    'high',
    '-level:v',
    '4.2',
    ...OUT_TAGS,
    ...output(liveOf(hw))
  ]
  const attempt = async (hw: boolean) => {
    if (cancelled.has(id)) return false
    if (live) {
      partFiles.delete(live)
      await fs.rm(live, { force: true })
    }
    live = liveOf(hw)
    if (live) {
      partFiles.add(live)
      onProgress(0, live)
    }
    let line = ''
    const { proc, done } = run('copy', args(hw), (chunk) => {
      // Progress arrives as key=value lines, which can be split across chunks.
      const lines = (line + chunk).split('\n')
      line = lines.pop() ?? ''
      for (const l of lines) {
        const m = /^out_time_us=(\d+)/.exec(l)
        if (m && duration > 0) onProgress(Math.min(1, Number(m[1]) / 1e6 / duration), live ?? undefined)
      }
    })
    copyProcs.set(id, proc)
    // Making copies ahead of time stays out of the way of everything else.
    if (background && proc.pid)
      try {
        setPriority(proc.pid, os.priority.PRIORITY_BELOW_NORMAL)
      } catch {
        // Not permitted here; run at normal priority.
      }
    const ok = (await done).code === 0
    copyProcs.delete(id)
    return ok
  }
  partFiles.add(part)
  let made = false
  try {
    // Hardware decoding where it works, else software.
    if (!(await attempt(true)) && !cancelled.has(id) && !(await attempt(false))) throw new Error('Could not make a playback copy')
    if (cancelled.has(id)) throw new Error('cancelled')
    await fs.rename(part, out)
    made = true
    onProgress(1)
  } finally {
    cancelled.delete(id)
    copyProcs.delete(id)
    partFiles.delete(part)
    await fs.rm(part, { force: true })
    const lv = live
    if (lv) {
      // A finished stream may still be playing for a moment, until the copy takes over.
      const remove = () => {
        partFiles.delete(lv)
        fs.rm(lv, { force: true }).catch(() => {})
      }
      if (made) setTimeout(remove, 60_000)
      else remove()
    }
  }
  await prune(COPIES, COPY_BYTES)
}
