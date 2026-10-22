// Downloads a static ffmpeg build for a target into vendor/ffmpeg/<os>-<arch>/, where
// electron-builder picks it up. Usage: node scripts/fetch-ffmpeg.mjs [win|mac|linux] [x64|arm64]
import { createWriteStream, existsSync, mkdirSync, chmodSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createGunzip } from 'node:zlib'

const OS = { win32: 'win', darwin: 'mac', linux: 'linux' }
const PLATFORM = { win: 'win32', mac: 'darwin', linux: 'linux' }
const os = process.argv[2] ?? OS[process.platform]
const arch = process.argv[3] ?? process.arch
const pkg = JSON.parse(readFileSync('node_modules/ffmpeg-static/package.json', 'utf8'))
const tag = pkg['ffmpeg-static']['binary-release-tag']
const dir = join('vendor', 'ffmpeg', `${os}-${arch}`)
const file = join(dir, os === 'win' ? 'ffmpeg.exe' : 'ffmpeg')

if (existsSync(file)) {
  console.log(`ffmpeg already present: ${file}`)
} else {
  const base = `https://github.com/eugeneware/ffmpeg-static/releases/download/${tag}`
  const name = `${PLATFORM[os]}-${arch}`
  mkdirSync(dir, { recursive: true })
  console.log(`Downloading ffmpeg ${tag} for ${name}…`)
  const res = await fetch(`${base}/ffmpeg-${name}.gz`)
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`)
  await pipeline(Readable.fromWeb(res.body), createGunzip(), createWriteStream(file))
  chmodSync(file, 0o755)
  const license = await fetch(`${base}/${name}.LICENSE`)
  if (license.ok) await pipeline(Readable.fromWeb(license.body), createWriteStream(join(dir, 'LICENSE')))
  console.log(`Saved ${file}`)
}
