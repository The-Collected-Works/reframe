import { DEFAULT_SETTINGS } from '@shared/framing/framing'
import { migrate } from '@shared/project/migrate'
import { PROJECT_VERSION } from '@shared/project/project'
import type { Artboard, CropSettings, ProjectFile, SettingKey } from '@shared/types'

/**
 * The project: artboards (each with default settings and per-asset overrides), video trims and
 * export preferences, saved next to the assets. Everything here is plain data in, plain data out.
 */

/** Every setting that frames an asset (all but whether it's exported). */
export const FRAMING_KEYS = (Object.keys(DEFAULT_SETTINGS) as SettingKey[]).filter((k) => k !== 'skip')

export const uid = (): string => Math.random().toString(36).slice(2, 10)

export function newBoard(name: string, width: number, height: number, defaults: CropSettings = DEFAULT_SETTINGS): Artboard {
  return { id: uid(), name, width, height, defaults: { ...defaults }, overrides: {} }
}

export function emptyProject(): ProjectFile {
  return {
    version: PROJECT_VERSION,
    artboards: [newBoard('Square', 1080, 1080)],
    clips: {},
    export: {
      dir: null,
      imageFormat: 'png',
      imageQuality: 0.92,
      videoCrf: 18,
      videoFormat: 'mp4',
      gifWidth: 600,
      gifFps: 15,
      gifColors: 128,
      gifDither: 'light',
      gifDenoise: true,
      skipBoards: []
    },
    items: {},
    files: {}
  }
}

const KNOWN = new Set(Object.keys(DEFAULT_SETTINGS))
/** Drops settings this version doesn't know (e.g. ones removed since the file was saved). */
const known = (o: object | undefined): Partial<CropSettings> =>
  Object.fromEntries(Object.entries(o ?? {}).filter(([k]) => KNOWN.has(k))) as Partial<CropSettings>

/**
 * A project file as saved, made whole: brought up to date if it's from an earlier format (see
 * migrate), with anything missing filled in. One from a newer format is taken as far as this
 * version understands it (it's read-only: see ProjectLock).
 */
export function normalizeProject(saved: ProjectFile | null): ProjectFile {
  const base = emptyProject()
  const p = saved && saved.version < PROJECT_VERSION ? migrate(saved) : saved
  if (!p || !p.artboards?.length) return base
  return {
    version: PROJECT_VERSION,
    artboards: p.artboards.map((b) => ({
      ...b,
      defaults: { ...DEFAULT_SETTINGS, ...known(b.defaults) },
      overrides: Object.fromEntries(
        Object.entries(b.overrides ?? {})
          .map(([n, o]) => [n, known(o)] as const)
          .filter(([, o]) => Object.keys(o).length)
      )
    })),
    clips: p.clips ?? {},
    export: { ...base.export, ...p.export },
    items: p.items ?? {},
    files: p.files ?? {}
  }
}

/** Whether applying `patch` to `o` would change it. */
export const changes = <T extends object>(o: T | undefined, patch: Partial<T>): boolean => Object.entries(patch).some(([k, v]) => !o || o[k as keyof T] !== v)

/**
 * Sets overrides on `names`. An override is set by editing an asset and removed only by an
 * explicit reset, even if its value happens to equal the default, so it never silently starts
 * following defaults. The overrides map is copied once, however many assets change; nothing
 * changing returns the same board.
 */
export function withOverrides(b: Artboard, names: string[], patch: Partial<CropSettings> | ((name: string) => Partial<CropSettings>)): Artboard {
  let overrides: Artboard['overrides'] | null = null
  for (const name of names) {
    const p = typeof patch === 'function' ? patch(name) : patch
    if (!changes(b.overrides[name], p) && b.overrides[name]) continue
    overrides ??= { ...b.overrides }
    overrides[name] = { ...b.overrides[name], ...p }
    if (!Object.keys(overrides[name]).length) delete overrides[name]
  }
  return overrides ? { ...b, overrides } : b
}

/** Removes overrides for `keys` on `names`, so they follow the defaults again. */
export function withoutOverrides(b: Artboard, names: string[], keys: SettingKey[]): Artboard {
  let overrides: Artboard['overrides'] | null = null
  for (const name of names) {
    const current = b.overrides[name]
    if (!current || !keys.some((k) => k in current)) continue
    overrides ??= { ...b.overrides }
    const o = { ...current }
    for (const k of keys) delete o[k]
    if (Object.keys(o).length) overrides[name] = o
    else delete overrides[name]
  }
  return overrides ? { ...b, overrides } : b
}

/**
 * Whether an asset's framing has been adjusted away from the artboard's defaults. Being left out
 * of the export isn't an adjustment: it's about the asset, not how it's framed.
 */
export const hasOverrides = (board: Artboard, name: string): boolean => Object.keys(board.overrides[name] ?? {}).some((k) => k !== 'skip')

/** Whether an item has been adjusted on `board`: its framing, or a composition's cells or how they're arranged. */
export const isAdjusted = (board: Artboard, name: string, composition = false): boolean =>
  hasOverrides(board, name) ||
  (composition &&
    (Object.keys(board.splits?.[name] ?? {}).length > 0 || Object.keys(board.overrides).some((k) => k.startsWith(name + '/') && hasOverrides(board, k))))

/** A video's trim, filled in: from 0 and to the end unless trimmed. */
export const clipFor = (project: ProjectFile, name: string, duration: number): { start: number; end: number } => {
  const c = project.clips[name]
  return { start: c?.start ?? 0, end: c?.end ?? duration }
}
