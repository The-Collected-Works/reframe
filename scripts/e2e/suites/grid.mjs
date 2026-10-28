// The grid: folders, selection, editing and undo, autosave, watching the folder, artboards, filters.

import assert from 'node:assert/strict'
import { copyFileSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { launch } from '../app.mjs'
import { sleep } from '../cdp.mjs'

const cells = (app) => app.eval(`document.querySelectorAll('.cell').length`)
const selected = (app) => app.eval(`document.querySelectorAll('.cell.selected').length`)
const values = (app) => app.eval(`[...document.querySelectorAll('.inspector input')].slice(0, 2).map((i) => i.value).join(' ')`)
const tabs = (app) => app.eval(`[...document.querySelectorAll('.tab')].map((t) => t.textContent.trim()).join(' / ')`)
const header = (folder) => `.grid-folder[data-folder="${folder}"] > .grid-section`

/** Opens the right-click menu at `selector` and chooses the item matching `label`. */
async function menu(app, selector, label) {
  const p = await app.point(selector, 0.3, 0.5)
  await app.click(p.x, p.y, { button: 'right' })
  await app.waitFor(`document.querySelector('.ctx-item')`, 3000, 'the menu')
  await app.eval(`[...document.querySelectorAll('.ctx-item')].find((b) => ${label}.test(b.textContent)).click()`)
}

/**
 * In View options (left open, as it stays while things change): shows or hides the value called
 * `label`, or with `only`, shows just it in its group; 'Show all' shows everything.
 */
async function viewOption(app, label, { only = false } = {}) {
  if (!(await app.eval(`!!document.querySelector('.popover')`))) await app.clickOn('[title^="View options"]')
  await app.waitFor(`document.querySelector('.popover .value')`, 3000, 'View options')
  if (label === 'Show all') await app.eval(`document.querySelector('.popover .show-all')?.click()`)
  else
    await app.eval(
      `[...document.querySelectorAll('.popover .value')].find((v) => v.querySelector('.name').textContent.trim() === ${JSON.stringify(label)}).querySelector(${JSON.stringify(only ? '.only' : '.toggle')}).click()`
    )
  await sleep(300)
}

export default {
  media: 'photos',
  tests: [
    [
      'shows every photo, by folder',
      async (ctx) => {
        ctx.app = await launch(ctx.folder)
        const app = ctx.app
        // Thumbnails draw as they come on screen: the first rows, at least.
        await app.waitFor(`document.querySelectorAll('.cell canvas[data-ready]').length >= 4`, 20000, 'the first thumbnails')
        assert.equal(await cells(app), 13)
        assert.deepEqual(await app.eval(`[...document.querySelectorAll('.grid-folder[data-folder]')].map((g) => g.dataset.folder).filter(Boolean)`), [
          'Shoot A',
          'Shoot B',
          'Shoot B/Day 1'
        ])
      }
    ],
    [
      'a dragged value undoes and redoes in one step',
      async ({ app }) => {
        await app.clickOn('.cell .frame')
        await app.waitFor(`document.querySelectorAll('.cell.selected').length === 1`)
        const label = await app.point('.inspector .num-label')
        await app.drag(label.x, label.y, label.x + 60, label.y)
        assert.equal(await values(app), '60 0')
        await app.key('z', 'ctrl')
        assert.equal(await values(app), '0 0')
        await app.key('z', 'ctrl+shift')
        assert.equal(await values(app), '60 0')
      }
    ],
    [
      'saves edits beside the photos',
      async ({ app, folder }) => {
        const file = join(folder, '.reframe.json')
        for (let i = 0; i < 30 && !existsSync(file); i++) await sleep(100)
        assert.ok(existsSync(file), '.reframe.json written')
        assert.ok(await app.eval('true'))
      }
    ],
    [
      'Esc closes a popover and keeps the selection',
      async ({ app }) => {
        await app.clickOn('[title^="View options"]')
        await app.waitFor(`document.querySelector('.popover')`)
        await app.key('Escape')
        await sleep(400)
        assert.equal(await app.eval(`document.querySelectorAll('.popover').length`), 0)
        assert.equal(await selected(app), 1)
      }
    ],
    [
      'box select from empty space',
      async ({ app }) => {
        const r = await app.eval(`(() => {
          const c = document.querySelectorAll('.grid-folder[data-folder="Shoot A"] .cell')
          const a = c[0].getBoundingClientRect(), b = c[1].getBoundingClientRect()
          return { x0: a.left - 6, y0: a.top - 4, x1: b.left + b.width / 2, y1: b.top + b.height / 2 }
        })()`)
        await app.drag(r.x0, r.y0, r.x1, r.y1)
        await sleep(300)
        const names = await app.eval(`[...document.querySelectorAll('.cell.selected')].map((c) => c.dataset.name)`)
        assert.deepEqual(names, ['Shoot A/photo-05.jpg', 'Shoot A/photo-06.jpg'])
        assert.equal(await app.eval(`getComputedStyle(document.querySelector('.marquee')).display`), 'none')
      }
    ],
    [
      'folders fold and unfold',
      async ({ app }) => {
        await app.clickOn(header('Shoot A'))
        await app.waitFor(`document.querySelectorAll('.cell').length === 7`, 3000, 'Shoot A to fold')
        await app.clickOn(header('Shoot A'))
        await app.waitFor(`document.querySelectorAll('.cell').length === 13`, 3000, 'Shoot A to unfold')
      }
    ],
    [
      'files added to the folder show up, and removed ones go',
      async ({ app, folder }) => {
        const added = join(folder, 'Shoot B', 'added.jpg')
        copyFileSync(join(folder, 'photo-01.jpg'), added)
        await app.waitFor(`document.querySelector('.cell[data-name="Shoot B/added.jpg"]')`, 8000, 'the new file')
        rmSync(added)
        await app.waitFor(`!document.querySelector('.cell[data-name="Shoot B/added.jpg"]')`, 8000, 'the file to go')
      }
    ],
    [
      'a folder can be excluded, and included again',
      async ({ app }) => {
        await menu(app, header('Shoot B'), '/Exclude/')
        await app.waitFor(`document.querySelectorAll('.cell').length === 10`, 5000, 'Shoot B to go')
        assert.ok(await app.eval(`document.querySelector('.grid-folder[data-folder="Shoot B"]').classList.contains('excluded')`))
        await menu(app, `.grid-folder[data-folder="Shoot B"] .grid-section`, '/Include/')
        await app.waitFor(`document.querySelectorAll('.cell').length === 13`, 5000, 'Shoot B to come back')
      }
    ],
    [
      'artboards: add one, delete it, undo',
      async ({ app }) => {
        await app.clickOn('[title="Add artboard"]')
        await app.waitFor(`document.querySelector('.popover .menu-item')`)
        await app.eval(`[...document.querySelectorAll('.popover .menu-item')].find((b) => /Story/.test(b.textContent)).click()`)
        await sleep(400)
        assert.equal(await tabs(app), 'Square 1080×1080 / Story 1080×1920')
        await menu(app, '.tab.on', '/Delete/')
        await sleep(300)
        assert.equal(await tabs(app), 'Square 1080×1080')
        await app.key('z', 'ctrl')
        await sleep(300)
        assert.equal(await tabs(app), 'Square 1080×1080 / Story 1080×1920')
      }
    ],
    [
      'view filters hide what’s unticked, and Show all brings it back',
      async ({ app }) => {
        await viewOption(app, 'Images')
        assert.equal(await cells(app), 0)
        assert.ok(await app.eval(`/matches your view/.test(document.body.innerText)`), 'says nothing matches')
        // Only images: the photos again (Videos hidden instead).
        await viewOption(app, 'Images', { only: true })
        assert.equal(await cells(app), 13)
        assert.ok(await app.eval(`!!document.querySelector('[title^="View options"].dot, [title^="View options (hiding videos)"]')`), 'says what’s hidden')
        await viewOption(app, 'Show all')
        assert.equal(await cells(app), 13)
        await app.key('Escape')
      }
    ],
    [
      'hiding what’s left out: an asset left out stays while it’s selected, then goes',
      async ({ app }) => {
        await viewOption(app, 'Excluded from export')
        await app.key('Escape')
        const before = await cells(app)
        const first = await app.eval(`document.querySelector('.cell').dataset.name`)
        await menu(app, `.cell[data-name="${first}"] .frame`, /Leave Out of Export/)
        await sleep(300)
        assert.ok(await app.eval(`document.querySelector('.cell[data-name="${first}"]')?.classList.contains('held')`), 'still there, faded')
        await app.key('Escape')
        await sleep(300)
        assert.equal(await cells(app), before - 1)
        await app.key('z', 'ctrl')
        await sleep(300)
        assert.equal(await cells(app), before, 'undo brings it back')
        await viewOption(app, 'Show all')
        await app.key('Escape')
      }
    ]
  ]
}
