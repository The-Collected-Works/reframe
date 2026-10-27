// Test media, made with the bundled ffmpeg: photos in nested folders, and one clip in each codec the
// app has to handle. Made once into a cache folder, then copied fresh for each suite.

import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
export const FFMPEG = require('ffmpeg-static')

const ff = (...args) => execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...args])

/** A 1600×1200 photo, different for each `seed`. */
const photo = (file, seed) => ff('-f', 'lavfi', '-i', `mandelbrot=s=1600x1200:start_scale=${2 + seed * 0.37}:end_pts=1`, '-frames:v', '1', '-q:v', '3', file)

/** A 4 second 1280×720 clip at 30fps, encoded as `codec`. */
function clip(file, codec) {
  const src = ['-f', 'lavfi', '-i', 'testsrc2=s=1280x720:r=30:d=4']
  const enc = {
    h264: ['-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p'],
    hevc: ['-c:v', 'libx265', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-tag:v', 'hvc1'],
    prores: ['-c:v', 'prores_ks', '-profile:v', '1'],
    vp9: ['-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8', '-b:v', '2M']
  }[codec]
  ff(...src, ...enc, file)
}

/**
 * The fixture folders under `cache` (made if they aren't there):
 * - photos: 4 at the top, 6 in "Shoot A", 2 in "Shoot B" and 1 in "Shoot B/Day 1";
 * - videos: h264.mp4, hevc.mp4, prores.mov, vp9.webm.
 */
export function fixtures(cache) {
  const photos = join(cache, 'photos')
  const videos = join(cache, 'videos')
  if (!existsSync(join(photos, '.done'))) {
    rmSync(photos, { recursive: true, force: true })
    let n = 0
    for (const [dir, count] of [
      ['', 4],
      ['Shoot A', 6],
      ['Shoot B', 2],
      ['Shoot B/Day 1', 1]
    ]) {
      mkdirSync(join(photos, dir), { recursive: true })
      for (let i = 1; i <= count; i++) photo(join(photos, dir, `photo-${String(++n).padStart(2, '0')}.jpg`), n)
    }
    mkdirSync(join(photos, '.done'))
  }
  if (!existsSync(join(videos, '.done'))) {
    rmSync(videos, { recursive: true, force: true })
    mkdirSync(videos, { recursive: true })
    clip(join(videos, 'h264.mp4'), 'h264')
    clip(join(videos, 'hevc.mp4'), 'hevc')
    clip(join(videos, 'prores.mov'), 'prores')
    clip(join(videos, 'vp9.webm'), 'vp9')
    mkdirSync(join(videos, '.done'))
  }
  return { photos, videos }
}

/** A fresh copy of a fixture folder at `to` (without the marker saying it's complete). */
export function freshCopy(from, to) {
  rmSync(to, { recursive: true, force: true })
  cpSync(from, to, { recursive: true, filter: (src) => !src.endsWith('.done') })
  return to
}

/** A video file's size and length, as ffmpeg reads them (ffmpeg-static has no ffprobe). */
export function probe(file) {
  let info = ''
  try {
    execFileSync(FFMPEG, ['-hide_banner', '-i', file], { stdio: ['ignore', 'ignore', 'pipe'] })
  } catch (e) {
    // With no output given, ffmpeg exits with an error after describing the input.
    info = String(e.stderr)
  }
  const size = /Video: .*?(\d{2,5})x(\d{2,5})/.exec(info)
  const d = /Duration: (\d+):(\d+):([\d.]+)/.exec(info)
  return {
    width: size ? Number(size[1]) : 0,
    height: size ? Number(size[2]) : 0,
    duration: d ? Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]) : 0
  }
}
