import { resolveSettings } from '@shared/framing/framing'
import type { Artboard, Clip, CropSettings, ExportPrefs, CompositionItem, Fingerprint, ProjectFile, SettingKey, SplitArrangement } from '@shared/types'
import { History } from './history.svelte'
import { relinked, sameFiles } from './model/files'
import { withComposition, withSplit } from './model/items'
import { changes, emptyProject, FRAMING_KEYS, newBoard, normalizeProject, uid, withOverrides, withoutOverrides } from './model/project'

/**
 * The project: its artboards (each with default settings and per-item overrides), video trims,
 * variants and compositions, and export preferences, with undo. Saved next to the assets (see App). Edits
 * name their targets: a list of items (assets, variants, composition slots), or none for the artboard's
 * defaults.
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

  /** A folder's project as saved (or a new one), with nothing to undo. */
  load(saved: ProjectFile | null): void {
    const file = normalizeProject(saved)
    this.history.reset(file)
    this.boardId = file.artboards[0].id
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
    this.history.commit({ ...this.file, clips })
  }

  addBoard(name: string, width: number, height: number): Artboard {
    const board = newBoard(name, width, height, this.board.defaults)
    this.history.commit({ ...this.file, artboards: [...this.file.artboards, board] })
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
    this.history.commit({ ...this.file, artboards })
    this.boardId = copy.id
  }

  removeBoard(id: string): void {
    if (this.file.artboards.length < 2) return
    const artboards = this.file.artboards.filter((b) => b.id !== id)
    this.history.commit({ ...this.file, artboards })
    if (this.boardId === id) this.boardId = artboards[0].id
  }

  /**
   * Changes reaching across the project (adding or removing variants and compositions, a composition's slots),
   * made by the functions in model/items. Returning the file unchanged changes nothing.
   */
  change(fn: (file: ProjectFile) => ProjectFile, key = ''): void {
    const next = fn(this.file)
    if (next !== this.file) this.history.commit(next, key)
  }

  /** A composition's own settings (name, spacing, background, duration). Successive changes to one merge. */
  editComposition(key: string, patch: Partial<CompositionItem>): void {
    this.change((f) => withComposition(f, key, patch), `composition:${key}:${Object.keys(patch).sort()}`)
  }

  /** How one of a composition's splits is arranged on the current artboard (null: as the artboard's shape has it). */
  setSplit(composition: string, split: string, set: SplitArrangement | null): void {
    this.mapBoard((b) => withSplit(b, composition, split, set), `split:${composition}:${split}`)
  }

  /** Every split of a composition back to following the current artboard. */
  resetSplits(composition: string): void {
    this.mapBoard((b) => {
      if (!b.splits?.[composition]) return b
      const { [composition]: _gone, ...splits } = b.splits
      return { ...b, splits }
    })
  }

  /** Export preferences aren't edits: saved with the project, but never undone. */
  setExportPrefs(patch: Partial<ExportPrefs>): void {
    this.history.replace({ ...this.file, export: { ...this.file.export, ...patch } })
  }

  /** Files renamed or moved (from → to): every reference follows them, in what undo and redo bring back too. */
  relink(moves: Map<string, string>): void {
    if (moves.size) this.history.map((f) => relinked(f, moves))
  }

  /** The files' fingerprints aren't edits either: kept up to date, never undone. */
  setFiles(files: Record<string, Fingerprint>): void {
    if (!sameFiles(files, this.file.files ?? {})) this.history.replace({ ...this.file, files })
  }

  undo(): boolean {
    return this.afterStep(this.history.undo(this.keepUnrecorded))
  }

  redo(): boolean {
    return this.afterStep(this.history.redo(this.keepUnrecorded))
  }

  private keepUnrecorded = (to: ProjectFile, from: ProjectFile): ProjectFile => ({ ...to, export: from.export, files: from.files })

  /** Undo or redo can remove the artboard being edited; then the first one is. */
  private afterStep(stepped: boolean): boolean {
    if (stepped && !this.file.artboards.some((b) => b.id === this.boardId)) this.boardId = this.file.artboards[0].id
    return stepped
  }

  /** Changes one artboard (the current one by default). Returning it unchanged changes nothing. */
  private mapBoard(fn: (b: Artboard) => Artboard, key = '', id = this.boardId): void {
    const i = this.file.artboards.findIndex((b) => b.id === id)
    if (i < 0) return
    const board = fn(this.file.artboards[i])
    if (board === this.file.artboards[i]) return
    const artboards = [...this.file.artboards]
    artboards[i] = board
    this.history.commit({ ...this.file, artboards }, key)
  }
}

export const project = new Project()
