import type { ProjectFile } from '../types'
import { PROJECT_VERSION } from './project'

/** A project file as some earlier format saved it. */
type Saved = { version: number } & Record<string, unknown>

/**
 * How each format becomes the next: keyed by the format it reads. Add one whenever PROJECT_VERSION
 * goes up, with a test from a file saved the old way (project.test.ts). Steps only change what the
 * format changed; filling in what's missing is normalizeProject's.
 */
const steps: Record<number, (p: Saved) => Saved> = {
  // Everything 2 added is new fields. While compositions were being built they were saved in
  // format 1 as "grid", then "layout" (both bentos).
  1: (p) => ({
    ...p,
    version: 2,
    items: Object.fromEntries(
      Object.entries((p.items ?? {}) as Record<string, { kind: string }>).map(([k, i]) => [
        k,
        i.kind === 'grid' || i.kind === 'layout' ? { ...i, kind: 'composition', type: 'bento' } : i
      ])
    )
  })
}

/** A project file from an earlier format (or this one), as this format saves it. */
export function migrate(file: { version: number }): ProjectFile {
  let p = file as Saved
  while (p.version < PROJECT_VERSION) {
    const step = steps[p.version]
    if (!step) throw new Error(`No way to read project format ${p.version}`)
    p = step(p)
  }
  return p as unknown as ProjectFile
}
