import { resolveSettings } from '@shared/layout'
import type { ProjectLock, ProjectRead } from '@shared/project'
import type { Artboard, Clip, CropSettings, ExportPrefs, ProjectFile, SettingKey } from '@shared/types'
import { showToast } from '../ui'
import { History } from './history.svelte'
import { changes, emptyProject, FRAMING_KEYS, newBoard, normalizeProject, uid, withOverrides, withoutOverrides } from './model/project'

/**
 * The project: its artboards (each with default settings and per-asset overrides), video trims and
 * export preferences, with undo. Saved next to the assets (see App). Edits name their targets: a
 * list of assets, or none for the artboard's defaults.
 */
class Project {
  private history = new History<ProjectFile>(emptyProject())
  /** The artboard being edited. */
  boardId = $state.raw('')
  /** Copied overrides, ready to paste. */
  clipboard = $state.raw<Partial<CropSettings> | null>(null)

  get file(): ProjectFile {
    return this.history.current
  }

  /** The current artboard. */
  readonly board = $derived(this.file.artboards.find((b) => b.id === this.boardId) ?? this.file.artboards[0])

  /** Why it isn't being saved, or null (see ProjectLock). Newer or unreadable, it's read-only. */
  lock = $state.raw<ProjectLock | null>(null)
  readonly readOnly = $derived(this.lock?.reason === 'newer' || this.lock?.reason === 'unreadable')
  /** Bumped on every load, so autosave can tell a project loaded from one edited. */
  loads = $state(0)

  /**
   * A folder's project as read (or a new one), with nothing to undo. A newer one is shown as far
   * as this version understands it. Reloading keeps the artboard being edited, if it's still there.
   */
  load(read: ProjectRead | null): void {
    let file: ProjectFile
    try {
      file = normalizeProject(read?.file ?? null)
    } catch {
      file = emptyProject()
    }
    const board = this.boardId
    this.history.reset(file)
    this.lock = read?.lock ?? null
    this.loads++
    this.boardId = file.artboards.some((b) => b.id === board) ? board : file.artboards[0].id
  }

  /** An asset's settings on the current artboard: its overrides over the defaults. */
  settingsOf(name: string): CropSettings {
    return resolveSettings(this.board, name)
  }

  /** Applies `patch` to `names`, or to the defaults when there are none. */
  edit(names: string[], patch: Partial<CropSettings>): void {
    const key = `edit:${Object.keys(patch).sort()}:${names}`
    if (!names.length) this.mapBoard((b) => (changes(b.defaults, patch) ? { ...b, defaults: { ...b.defaults, ...patch } } : b), key)
    else this.mapBoard((b) => withOverrides(b, names, patch), key)
  }

  /** Like edit(), with the patch computed from each target's current settings. */
  editEach(names: string[], fn: (s: CropSettings) => Partial<CropSettings>): void {
    if (!names.length) return this.edit([], fn(this.board.defaults))
    this.mapBoard((b) => withOverrides(b, names, (n) => fn(resolveSettings(b, n))))
  }

  /** Makes `source`'s values for `keys` the defaults; `names` then follow them. */
  makeDefault(source: string, names: string[], keys: SettingKey[]): void {
    const values = resolveSettings(this.board, source)
    const patch = Object.fromEntries(keys.map((k) => [k, values[k]])) as Partial<CropSettings>
    this.mapBoard((b) => withoutOverrides({ ...b, defaults: { ...b.defaults, ...patch } }, names, keys))
  }

  /** Removes overrides so `keys` follow the defaults again. */
  resetKeys(names: string[], keys: SettingKey[]): void {
    this.mapBoard((b) => withoutOverrides(b, names, keys))
  }

  /**
   * Copies an asset's overrides (not its resolved values), so pasted assets keep following the
   * defaults for everything the source does. Returns how many settings were copied.
   */
  copy(name: string): number {
    const { skip: _skip, ...overrides } = this.board.overrides[name] ?? {}
    this.clipboard = overrides
    return Object.keys(overrides).length
  }

  paste(names: string[]): boolean {
    const clipboard = this.clipboard
    if (!clipboard || !names.length) return false
    this.mapBoard((b) => withOverrides(withoutOverrides(b, names, FRAMING_KEYS), names, clipboard))
    return true
  }

  setClip(name: string, clip: Clip | null): void {
    const clips = { ...this.file.clips }
    if (clip && (clip.start > 0 || clip.end != null)) clips[name] = clip
    else delete clips[name]
    this.commit({ ...this.file, clips })
  }

  addBoard(name: string, width: number, height: number): Artboard {
    const board = newBoard(name, width, height, this.board.defaults)
    this.commit({ ...this.file, artboards: [...this.file.artboards, board] })
    this.boardId = board.id
    return board
  }

  updateBoard(id: string, patch: Partial<Pick<Artboard, 'name' | 'width' | 'height'>>): void {
    this.mapBoard((b) => (changes(b, patch) ? { ...b, ...patch } : b), '', id)
  }

  duplicateBoard(id: string): void {
    const src = this.file.artboards.find((b) => b.id === id)
    if (!src) return
    const copy: Artboard = { ...structuredClone(src), id: uid(), name: `${src.name} copy` }
    const artboards = [...this.file.artboards]
    artboards.splice(artboards.indexOf(src) + 1, 0, copy)
    this.commit({ ...this.file, artboards })
    this.boardId = copy.id
  }

  removeBoard(id: string): void {
    if (this.file.artboards.length < 2) return
    const artboards = this.file.artboards.filter((b) => b.id !== id)
    this.commit({ ...this.file, artboards })
    if (this.boardId === id) this.boardId = artboards[0].id
  }

  /** Export preferences aren't edits: saved with the project, but never undone. */
  setExportPrefs(patch: Partial<ExportPrefs>): void {
    this.history.replace({ ...this.file, export: { ...this.file.export, ...patch } })
  }

  undo(): boolean {
    return this.afterStep(this.history.undo(this.keepExport))
  }

  redo(): boolean {
    return this.afterStep(this.history.redo(this.keepExport))
  }

  private keepExport = (to: ProjectFile, from: ProjectFile): ProjectFile => ({ ...to, export: from.export })

  /** Undo or redo can remove the artboard being edited; then the first one is. */
  private afterStep(stepped: boolean): boolean {
    if (stepped && !this.file.artboards.some((b) => b.id === this.boardId)) this.boardId = this.file.artboards[0].id
    return stepped
  }

  private refused = -Infinity

  /** Whether it can be edited; when it can't (read-only), says so, at most every few seconds. */
  editable(): boolean {
    if (!this.readOnly) return true
    if (performance.now() - this.refused > 3000) {
      this.refused = performance.now()
      showToast(this.lock?.reason === 'newer' ? 'Read-only · saved by a newer Reframe' : 'Read-only · its project file couldn’t be read')
    }
    return false
  }

  /** Records an edit, unless it's read-only. */
  private commit(next: ProjectFile, key = ''): void {
    if (this.editable()) this.history.commit(next, key)
  }

  /** Changes one artboard (the current one by default). Returning it unchanged changes nothing. */
  private mapBoard(fn: (b: Artboard) => Artboard, key = '', id = this.boardId): void {
    const i = this.file.artboards.findIndex((b) => b.id === id)
    if (i < 0) return
    const board = fn(this.file.artboards[i])
    if (board === this.file.artboards[i]) return
    const artboards = [...this.file.artboards]
    artboards[i] = board
    this.commit({ ...this.file, artboards }, key)
  }
}

export const project = new Project()
