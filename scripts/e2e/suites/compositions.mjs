// Compositions: combining videos into one, playing it, exporting it, opening projects saved before
// they were called compositions; and variants, with the view filters that pick them out.

import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launch } from '../app.mjs'
import { sleep } from '../cdp.mjs'
import { probe } from '../media.mjs'

const names = (app) => app.eval(`[...document.querySelectorAll('.cell')].map((c) => c.querySelector('.cell-name')?.textContent.trim())`)

async function viewOption(app, label) {
  if (!(await app.eval(`!!document.querySelector('.popover')`))) await app.clickOn('[title^="View options"]')
  await app.waitFor(`document.querySelector('.popover .menu-item')`, 3000, 'View options')
  await app.eval(`[...document.querySelectorAll('.popover .menu-item')].find((b) => b.textContent.trim() === ${JSON.stringify(label)}).click()`)
  await sleep(300)
}

export default {
  media: 'videos',
  tests: [
    [
      'combines the selection into a composition',
      async (ctx) => {
        ctx.app = await launch(ctx.folder)
        const app = ctx.app
        await app.waitFor(`document.querySelectorAll('.cell canvas[data-ready]').length === 4`, 30000, 'every thumbnail')
        await app.clickOn('.cell .frame')
        await app.key('a', 'ctrl')
        await app.key('g', 'ctrl')
        await app.waitFor(`document.querySelector('.cell[data-name^="~"]')`, 5000, 'the composition')
        assert.equal(await app.eval(`document.querySelector('.cell[data-name^="~"] .cell-name').textContent.trim()`), 'Composition 1')
      }
    ],
    [
      'a hovered composition plays in its thumbnail, and goes back to it after',
      async ({ app }) => {
        const canvas = '.cell[data-name^="~"] canvas'
        const still = () =>
          app.eval(`(() => {
            const d = document.querySelector('${canvas}').getContext('2d').getImageData(0, 0, 200, 200).data
            let h = 0
            for (let i = 0; i < d.length; i += 7) h = (h * 31 + d[i]) | 0
            return h
          })()`)
        await app.key('Escape')
        // The pointer's still where the first thumbnail was (the composition's, now): off it first.
        await app.hover(5, 5)
        await sleep(1200)
        const before = await still()
        const p = await app.point('.cell[data-name^="~"] .frame')
        await app.hover(p.x, p.y)
        await sleep(2000)
        assert.ok((await app.pictures(canvas, 1500)) >= 10, 'pictures while hovered')
        await app.hover(5, 5)
        await sleep(1200)
        assert.equal(await still(), before, 'the thumbnail again')
      }
    ],
    [
      'plays every cell',
      async ({ app }) => {
        await app.clickOn('.cell[data-name^="~"] .frame')
        await app.key('e')
        await app.waitFor(`document.querySelector('.single .player .play')`, 5000, 'the player')
        await sleep(1500)
        await app.clickOn('.player .play')
        await sleep(500)
        assert.ok((await app.pictures('.stage canvas', 2000)) >= 10, 'pictures while playing')
        await app.clickOn('.player .play')
        await app.key('Escape')
        await app.key('Escape')
        await app.waitFor(`!document.querySelector('.single')`, 5000, 'the grid')
      }
    ],
    [
      'exports as a video, as long as its longest cell',
      async ({ app, folder }) => {
        await app.clickOn('.tools .primary')
        await app.waitFor(`document.querySelector('[role=dialog]')`)
        await app.eval(`[...document.querySelectorAll('[role=dialog] button')].find((b) => b.textContent.trim() === 'Export').click()`)
        await app.waitFor(`/exported/.test(document.querySelector('.overall-meta')?.textContent ?? '')`, 180000, 'the export')
        const out = probe(join(folder, 'export', 'Square', 'Composition 1.mp4'))
        assert.deepEqual([out.width, out.height], [1080, 1080])
        assert.ok(Math.abs(out.duration - 4) < 0.1, `4s long (${out.duration})`)
        await app.key('Escape')
      }
    ],
    [
      'a variant, and filters that pick out variants, compositions and videos',
      async ({ app }) => {
        await app.clickOn('.cell[data-name="h264.mp4"] .frame')
        await app.key('d', 'ctrl')
        await app.waitFor(`[...document.querySelectorAll('.cell-name')].some((n) => n.textContent.trim() === 'h264 copy')`, 3000, 'the variant')
        await viewOption(app, 'Variants')
        assert.deepEqual(await names(app), ['h264 copy'])
        await viewOption(app, 'Compositions')
        assert.deepEqual(await names(app), ['Composition 1', 'h264 copy'])
        await viewOption(app, 'Videos')
        assert.deepEqual(await names(app), ['h264 copy'])
        await viewOption(app, 'All')
        assert.equal((await names(app)).length, 6)
        await app.key('Escape')
      }
    ],
    [
      'opens projects saved when compositions were called layouts',
      async (ctx) => {
        await sleep(1000)
        await ctx.app.quit()
        const file = join(ctx.folder, '.reframe.json')
        const project = JSON.parse(readFileSync(file, 'utf8'))
        for (const item of Object.values(project.items)) {
          if (item.kind !== 'composition') continue
          item.kind = 'layout'
          delete item.type
        }
        writeFileSync(file, JSON.stringify(project))
        ctx.app = await launch(ctx.folder)
        const app = ctx.app
        await app.waitFor(`document.querySelector('.cell[data-name^="~"]')`, 10000, 'the composition')
        await app.clickOn('.cell[data-name^="~"] .frame')
        await app.waitFor(`/Bento/.test(document.querySelector('.inspector .tags')?.textContent ?? '')`, 3000, 'its type in the inspector')
      }
    ]
  ]
}
