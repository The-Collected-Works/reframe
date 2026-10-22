// From WSL: runs the dev build in the *Windows* Electron, so the app opens as a native Windows
// window while Vite, HMR and the source stay in WSL. Usage: npm run dev:win
import { spawn, spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'

if (!process.env.WSL_DISTRO_NAME) {
  console.error('dev:win is for WSL. On Windows or macOS, use npm run dev.')
  process.exit(1)
}

const electronPkg = resolve('node_modules/electron/package.json')
const require = createRequire(electronPkg)
const { version } = JSON.parse(readFileSync(electronPkg, 'utf8'))

// Electron must live on the Windows drive: Chromium won't launch its GPU process from a
// \\wsl.localhost path.
const windowsPath = (cmd) => spawnSync('cmd.exe', ['/c', cmd], { encoding: 'utf8', cwd: '/mnt/c' }).stdout.trim()
const localAppData = spawnSync('wslpath', ['-u', windowsPath('echo %LOCALAPPDATA%')], { encoding: 'utf8' }).stdout.trim()
const dir = join(localAppData, 'Reframe-dev', `electron-${version}`)
const exe = join(dir, 'electron.exe')

if (!existsSync(exe)) {
  console.log(`Fetching Windows Electron ${version}…`)
  const { downloadArtifact } = require('@electron/get')
  const { extract } = require('@electron-internal/extract-zip')
  const zip = await downloadArtifact({ version, artifactName: 'electron', platform: 'win32', arch: 'x64' })
  await extract(zip, { dir })
}

spawnSync(process.execPath, ['scripts/fetch-ffmpeg.mjs', 'win', 'x64'], { stdio: 'inherit' })

// ffmpeg too: launching it from the WSL filesystem takes ~1.4s every time (vs ~3ms from C:).
const ffmpegSrc = resolve('vendor/ffmpeg/win-x64/ffmpeg.exe')
const ffmpeg = join(localAppData, 'Reframe-dev', 'ffmpeg.exe')
if (!existsSync(ffmpeg) || statSync(ffmpeg).size !== statSync(ffmpegSrc).size) copyFileSync(ffmpegSrc, ffmpeg)

const child = spawn('npx', ['electron-vite', 'dev', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, ELECTRON_EXEC_PATH: resolve('scripts/electron-win.sh'), REFRAME_ELECTRON_WIN: exe, REFRAME_FFMPEG: ffmpeg }
})
child.on('exit', (code) => process.exit(code ?? 0))
