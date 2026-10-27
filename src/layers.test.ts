import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, normalize, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The code's layers, and what each may import (see the README's code layout). Lower layers never
 * reach up: what's in `shared` works anywhere, `lib` knows nothing of the app, the UI kit knows no
 * app state, config is plain data, and only features (the screens) and the app root use it all.
 */
const SRC = import.meta.dirname
const R = 'renderer/src'
const LAYERS: { name: string; path: string; may: string[] }[] = [
  { name: 'shared', path: 'shared', may: [] },
  { name: 'main', path: 'main', may: ['shared'] },
  { name: 'preload', path: 'preload', may: ['shared'] },
  { name: 'lib', path: `${R}/lib`, may: ['shared'] },
  { name: 'ui', path: `${R}/ui`, may: ['shared', 'lib'] },
  { name: 'config', path: `${R}/config`, may: ['shared', 'lib'] },
  { name: 'state', path: `${R}/state`, may: ['shared', 'lib', 'ui', 'config'] },
  { name: 'features', path: `${R}/features`, may: ['shared', 'lib', 'ui', 'config', 'state'] },
  { name: 'styles', path: `${R}/styles`, may: [] },
  { name: 'app', path: R, may: ['shared', 'lib', 'ui', 'config', 'state', 'features', 'styles'] }
]

const layerOf = (file: string) => LAYERS.filter((l) => file === l.path || file.startsWith(l.path + '/')).sort((a, b) => b.path.length - a.path.length)[0]

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    if (statSync(p).isDirectory()) return files(p)
    return /\.(ts|svelte)$/.test(n) && !/\.test\.ts$/.test(n) ? [p] : []
  })
}

describe('layers', () => {
  it('only import from the layers below them', () => {
    const wrong: string[] = []
    for (const abs of files(SRC)) {
      const file = relative(SRC, abs)
      const from = layerOf(file)
      if (!from) continue
      for (const [, spec] of readFileSync(abs, 'utf8').matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)) {
        const target = spec.startsWith('@shared/') ? 'shared/' + spec.slice(8) : spec.startsWith('.') ? normalize(join(dirname(file), spec)) : null
        const to = target && layerOf(target)
        if (to && to !== from && !from.may.includes(to.name)) wrong.push(`${file} (${from.name}) → ${spec} (${to.name})`)
      }
    }
    expect(wrong).toEqual([])
  })
})
