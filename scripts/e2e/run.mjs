// End-to-end tests: runs the built app on generated media and uses it as a person would, over the
// DevTools protocol. `npm run e2e` builds first; `node scripts/e2e/run.mjs [suite…]` runs some.
// On Linux it runs in a virtual display (xvfb-run) when there is one; E2E_SHOW=1 shows the window.

import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fixtures, freshCopy } from './media.mjs'
import compositions from './suites/compositions.mjs'
import grid from './suites/grid.mjs'
import single from './suites/single.mjs'

const SUITES = { grid, single, compositions }
const ROOT = join(tmpdir(), 'reframe-e2e')
const chosen = process.argv.slice(2)
const run = chosen.length ? chosen.map((n) => [n, SUITES[n]]) : Object.entries(SUITES)

mkdirSync(ROOT, { recursive: true })
process.stdout.write('Making test media… ')
const media = fixtures(join(ROOT, 'media'))
console.log('done')

let failed = 0
let passed = 0
for (const [name, suite] of run) {
  if (!suite) throw new Error(`No suite "${name}" (there's ${Object.keys(SUITES).join(', ')})`)
  console.log(`\n${name}`)
  const folder = freshCopy(media[suite.media], join(ROOT, `run-${name}`))
  const ctx = { folder, app: null }
  try {
    for (const [title, fn] of suite.tests) {
      const t0 = Date.now()
      try {
        await fn(ctx)
        passed++
        console.log(`  ✓ ${title} (${((Date.now() - t0) / 1000).toFixed(1)}s)`)
      } catch (e) {
        failed++
        console.log(
          `  ✗ ${title}\n      ${String(e.stack ?? e)
            .split('\n')
            .slice(0, 4)
            .join('\n      ')}`
        )
      }
    }
    const errors = ctx.app?.errors ?? []
    if (errors.length) {
      failed++
      console.log(`  ✗ uncaught in the page:\n      ${errors.join('\n      ')}`)
    }
  } finally {
    await ctx.app?.quit()
    rmSync(folder, { recursive: true, force: true })
  }
}

console.log(`\n${passed} passed${failed ? `, ${failed} failed` : ''}`)
process.exit(failed ? 1 : 0)
