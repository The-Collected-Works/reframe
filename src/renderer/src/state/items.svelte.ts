import { library, withMeta, type Asset, type AssetMeta } from './library.svelte'
import { entriesOf, itemsOf, type Entry } from './model/items'
import { project } from './project.svelte'
import { starts } from './starts.svelte'

/**
 * Every item, as rows: the folder's files, their variants and the compositions. Rebuilt only when the
 * files or the items themselves change, never for an edit to how something is framed, so dragging
 * a slider never re-lays out the grid.
 */
class Items {
  private last: { files: unknown; items: unknown; all: Entry[] } = { files: null, items: null, all: [] }

  readonly all = $derived.by((): Entry[] => {
    const files = library.assets
    const items = itemsOf(project.file)
    if (files !== this.last.files || items !== this.last.items) this.last = { files, items, all: entriesOf(files, items) }
    return this.last.all
  })

  private byKey = $derived(new Map(this.all.map((e) => [e.name, e])))

  entry(key: string | null | undefined): Entry | undefined {
    return key ? this.byKey.get(key) : undefined
  }

  /** What's been loaded about an item's file (a variant has its source's; a composition has no file). */
  meta(e: Entry): AssetMeta | undefined {
    return e.kind === 'composition' ? undefined : library.meta.get(e.source ?? e.name)
  }

  /** An item with what's been loaded about its file. */
  asset(key: string | null | undefined): Asset | undefined {
    const e = this.entry(key)
    return e && this.with(e)
  }

  /** The last asset made for each entry, and what from (see `with`). */
  private made = new WeakMap<Entry, { meta: AssetMeta | undefined; frame: ImageBitmap | undefined; asset: Asset }>()

  /**
   * An item with what's been loaded about its file. A video's thumbnail is the frame playback starts
   * on: its first, or once loaded, a trimmed one's start (see Starts).
   *
   * The same object for as long as nothing it's made from changes, so whatever reads an asset only
   * runs again when that asset does (not on every edit to the project).
   */
  with(e: Entry): Asset {
    const meta = this.meta(e)
    const at = e.kind === 'video' ? (project.file.clips[e.name]?.start ?? 0) : 0
    const frame = at > 0 ? starts.get({ path: e.path, mtime: e.mtime, at }) : undefined
    const last = this.made.get(e)
    if (last && last.meta === meta && last.frame === frame) return last.asset
    const a = withMeta(e, meta)
    const asset = e.kind !== 'video' ? a : frame ? { ...a, thumb: frame, thumbAt: at } : { ...a, thumbAt: 0 }
    this.made.set(e, { meta, frame, asset })
    return asset
  }
}

export const items = new Items()
