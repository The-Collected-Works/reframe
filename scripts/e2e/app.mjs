// Runs the built app (out/) on a folder, with a profile of its own, for a suite to drive.

import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Page, sleep } from './cdp.mjs'

const require = createRequire(import.meta.url)
const ELECTRON = require('electron')
const ROOT = resolve(import.meta.dirname, '../..')
let nextPort = 9333
const hasXvfb = process.platform === 'linux' && spawnSync('which', ['xvfb-run']).status === 0

/**
 * Starts the app on `folder` and connects to it once its grid shows (or `ready` holds). Returns the
 * page, plus `quit()`, which closes the app and removes its profile; and `log()`, what it printed.
 */
export async function launch(folder, { ready = "document.querySelector('.cell, .empty-state')", profile } = {}) {
  const port = nextPort++
  const dir = profile ?? mkdtempSync(join(tmpdir(), 'reframe-e2e-'))
  const args = [
    ROOT,
    `--user-data-dir=${dir}`,
    `--remote-debugging-port=${port}`,
    '--mute-audio',
    // A window behind others is throttled otherwise, and timings mean nothing.
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling',
    ...(process.platform === 'linux' ? ['--no-sandbox'] : []),
    folder
  ]
  // On Linux, in a virtual display where there's one (no windows popping up, and it works without
  // a desktop: CI, WSL); E2E_SHOW=1 shows them instead.
  const headless = process.platform === 'linux' && !process.env.E2E_SHOW && hasXvfb
  const [cmd, cmdArgs] = headless ? ['xvfb-run', ['-a', '-s', '-screen 0 1440x900x24', ELECTRON, ...args]] : [ELECTRON, args]
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const proc = spawn(cmd, cmdArgs, { env, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  proc.stdout.on('data', (d) => (output += d))
  proc.stderr.on('data', (d) => (output += d))

  const quit = async () => {
    page?.close()
    try {
      // The whole group: xvfb-run, Electron and its helpers.
      if (process.platform === 'win32') proc.kill()
      else process.kill(-proc.pid, 'SIGTERM')
    } catch {
      // Gone already.
    }
    await sleep(500)
    if (!profile) rmSync(dir, { recursive: true, force: true, maxRetries: 5 })
  }

  let page
  try {
    page = await Page.connect(port)
    await page.waitFor(ready, 30000, 'the app to show its folder')
  } catch (e) {
    await quit()
    throw new Error(`${e.message}\n${output.slice(-2000)}`)
  }
  return Object.assign(page, { quit, log: () => output, profile: dir })
}
