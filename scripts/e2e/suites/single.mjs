// One video at a time: hover previews, playback in every codec, scrubbing, trimming, the gizmo,
// zooming, and exporting.

import assert from 'node:assert/strict'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { launch } from '../app.mjs'
import { sleep } from '../cdp.mjs'
import { probe } from '../media.mjs'

const cell = (name) => `.cell[data-name="${name}"]`
const time = (app) => app.eval(`document.querySelector('.player .time').textContent`)
const fields = (app) => app.eval(`[...document.querySelectorAll('.inspector input')].slice(0, 4).map((i) => Number(i.value))`)
const seconds = (t) => {
  const [m, s] = t.split(':')
  return Number(m) * 60 + Number(s)
}

/** Opens a video in the single view (from the grid). */
async function open(app, name) {
  if (await app.eval(`!!document.querySelector('.single')`)) {
    await app.key('Escape')
    await app.key('Escape')
    await app.waitFor(`!document.querySelector('.single')`, 5000, 'the grid')
  }
  await app.clickOn(`${cell(name)} .frame`)
  await app.key('e')
  await app.waitFor(`document.querySelector('.single .player .play')`, 5000, 'the player')
  await sleep(1500)
}

/** Where the media's top-left handle is drawn (the first pure white pixel, scanning the stage). */
const handle = (app) =>
  app.eval(`(() => {
    const c = document.querySelector('.stage canvas'), r = c.getBoundingClientRect()
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
    const k = c.width / r.width
    for (let y = 0; y < c.height / 2; y++)
      for (let x = 0; x < c.width / 2; x++) {
        const i = (y * c.width + x) * 4
        if (d[i] === 255 && d[i + 1] === 255 && d[i + 2] === 255) return { x: Math.round(r.left + x / k + 4), y: Math.round(r.top + y / k + 4) }
      }
    return null
  })()`)

export default {
  media: 'videos',
  tests: [
    [
      'a hovered video plays in its thumbnail, and goes back to it after',
      async (ctx) => {
        ctx.app = await launch(ctx.folder)
        const app = ctx.app
        await app.waitFor(`document.querySelectorAll('.cell canvas[data-ready]').length === 4`, 30000, 'every thumbnail')
        const canvas = `${cell('h264.mp4')} canvas`
        const still = () =>
          app.eval(`(() => {
          const d = document.querySelector('${canvas}').getContext('2d').getImageData(0, 0, 200, 200).data
          let h = 0
          for (let i = 0; i < d.length; i += 7) h = (h * 31 + d[i]) | 0
          return h
        })()`)
        const before = await still()
        const p = await app.point(`${cell('h264.mp4')} .frame`)
        await app.hover(p.x, p.y)
        await sleep(1500)
        assert.ok((await app.pictures(canvas, 1500)) >= 10, 'pictures while hovered')
        await app.hover(5, 5)
        await sleep(1200)
        assert.equal(await still(), before, 'the thumbnail again')
      }
    ],
    [
      'plays HEVC (from its playback copy)',
      async ({ app }) => {
        await open(app, 'hevc.mp4')
        await app.clickOn('.player .play')
        await sleep(1500)
        assert.ok(await app.eval(`document.querySelector('.player .play').classList.contains('playing')`))
        assert.ok(seconds(await time(app)) > 0.3)
        await app.clickOn('.player .play')
      }
    ],
    [
      'a video loops round its trim',
      async ({ app }) => {
        await open(app, 'h264.mp4')
        await app.clickOn('.player .play')
        await sleep(5500)
        assert.ok(await app.eval(`document.querySelector('.player .play').classList.contains('playing')`))
        const t = seconds(await time(app))
        assert.ok(t > 0.5 && t < 3.5, `about 1.5s into its second time round (${t})`)
        await app.clickOn('.player .play')
      }
    ],
    [
      'scrubbing seeks to where the playhead is let go',
      async ({ app }) => {
        const a = await app.point('.timeline', 0.3)
        const b = await app.point('.timeline', 0.75)
        await app.drag(a.x, a.y, b.x, b.y)
        await sleep(800)
        assert.equal(await time(app), '0:03.0')
      }
    ],
    [
      "trimming changes what plays, and the grid's length",
      async ({ app }) => {
        const h = await app.point('.tl-handle.out')
        await app.drag(h.x, h.y, h.x - 100, h.y)
        await sleep(500)
        const length = seconds(await app.eval(`document.querySelectorAll('.player .time')[1].textContent`))
        assert.ok(length < 3.9 && length > 2, `trimmed (${length})`)
      }
    ],
    [
      'the gizmo moves and scales the media, and undoes',
      async ({ app }) => {
        const stage = await app.point('.stage canvas', 0.42, 0.4)
        await app.click(stage.x, stage.y)
        await sleep(600)
        const corner = await handle(app)
        assert.ok(corner, 'handles drawn once selected')
        await app.drag(corner.x, corner.y, corner.x + 60, corner.y + 60)
        await sleep(300)
        const [, , zoom] = await fields(app)
        assert.ok(zoom < 100, `scaled down (${zoom}%)`)
        await app.key('z', 'ctrl')
        await sleep(300)
        await app.drag(stage.x, stage.y, stage.x + 80, stage.y + 40)
        await sleep(300)
        const [x, y] = await fields(app)
        assert.ok(x > 0 && y > 0, `moved (${x}, ${y})`)
        assert.ok(await handle(app), 'still selected after the drag')
      }
    ],
    [
      'zooms the view with Ctrl and the wheel',
      async ({ app }) => {
        const p = await app.point('.stage canvas')
        await app.wheel(p.x, p.y, -240, 2)
        await sleep(400)
        assert.match(await app.eval(`document.querySelector('.zoom-chip').textContent.trim()`), /^\d+%$/)
      }
    ],
    [
      'exports every video at the artboard size',
      async ({ app, folder }) => {
        await app.key('Escape')
        await app.key('Escape')
        await app.waitFor(`!document.querySelector('.single')`, 5000, 'the grid')
        await app.clickOn('.tools .primary')
        await app.waitFor(`document.querySelector('[role=dialog]')`)
        await app.eval(`[...document.querySelectorAll('[role=dialog] button')].find((b) => b.textContent.trim() === 'Export').click()`)
        await app.waitFor(`/exported/.test(document.querySelector('.overall-meta')?.textContent ?? '')`, 120000, 'the export')
        const dir = join(folder, 'export', 'Square')
        const files = readdirSync(dir).filter((f) => !f.startsWith('.'))
        assert.deepEqual(files.sort(), ['h264.mp4', 'hevc.mp4', 'prores.mp4', 'vp9.mp4'])
        for (const f of files) assert.deepEqual([probe(join(dir, f)).width, probe(join(dir, f)).height], [1080, 1080], f)
        await app.key('Escape')
      }
    ],
    [
      'exports videos as GIFs, 600 wide by default',
      async ({ app, folder }) => {
        await app.waitFor(`!document.querySelector('[role=dialog]')`, 5000, 'the dialog closed')
        await app.clickOn('.tools .primary')
        await app.waitFor(`document.querySelector('[role=dialog]')`)
        const button = (label) => `[...document.querySelectorAll('[role=dialog] button')].find((b) => b.textContent.trim() === ${JSON.stringify(label)})`
        await app.eval(`${button('GIF')}.click()`)
        await app.waitFor(`!!${button('600')}`, 3000, 'the GIF options')
        await app.eval(`${button('Export')}.click()`)
        await app.waitFor(`/exported/.test(document.querySelector('.overall-meta')?.textContent ?? '')`, 120000, 'the export')
        const dir = join(folder, 'export', 'Square')
        const gifs = readdirSync(dir).filter((f) => f.endsWith('.gif'))
        assert.deepEqual(gifs.sort(), ['h264.gif', 'hevc.gif', 'prores.gif', 'vp9.gif'])
        for (const f of gifs) {
          const info = probe(join(dir, f))
          assert.deepEqual([info.width, info.height], [600, 600], f)
          assert.ok(info.duration > 0.5, `${f} moves (${info.duration}s)`)
        }
        assert.ok(!readdirSync(dir).some((f) => f.includes('.part')), 'no working files left')
        await app.key('Escape')
      }
    ]
  ]
}
