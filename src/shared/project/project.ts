import type { ProjectFile } from '../types'

/**
 * The project file's format, written into every save. Bump it for any change to what's saved, even
 * an added field, and add a step to migrate.ts: an app that finds a newer format than its own opens
 * the project read-only, so it never saves over what it doesn't understand (an older one would drop
 * what it doesn't know).
 * - 1: artboards, trims, export preferences (Reframe 0.6).
 * - 2: variants and compositions (`items`), file fingerprints (`files`), GIF export, each
 *   artboard's arrangement of compositions (`splits`), the artboards export leaves out.
 */
export const PROJECT_VERSION = 2

/** Why a folder's project can't be saved for now. */
export type ProjectLock =
  /** Saved by a newer Reframe (format `version`): read-only until this one is updated. */
  | { reason: 'newer'; version: number }
  /** Not a project file this can read (still syncing, a sync conflict, edited by hand): read-only,
      so it isn't replaced by an empty project. `backup`: the last good copy can be restored. */
  | { reason: 'unreadable'; backup: boolean }
  /** Changed by something else (another computer, another window) since it was read here: saving
      waits until it's reloaded, or overwritten on purpose. */
  | { reason: 'changed' }

/** A folder's project file as read: none yet, the project, or why it can't be edited. */
export interface ProjectRead {
  /** As saved (null: none, or unreadable): an older format is brought up to date by `migrate`, a
      newer one is as much of it as this version understands. */
  file: ProjectFile | null
  lock: ProjectLock | null
}

/** A project file's text, read: its project, unless it's from a newer format or can't be read. */
export function parseProject(text: string): ProjectRead {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return { file: null, lock: { reason: 'unreadable', backup: false } }
  }
  const version = (data as { version?: unknown } | null)?.version
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) return { file: null, lock: { reason: 'unreadable', backup: false } }
  if (version > PROJECT_VERSION) return { file: data as ProjectFile, lock: { reason: 'newer', version } }
  return { file: data as ProjectFile, lock: null }
}
