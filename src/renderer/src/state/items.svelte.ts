import { library, withMeta, type Asset, type AssetMeta } from './library.svelte'
import { entriesOf, itemsOf, type Entry } from './model/items'
import { project } from './project.svelte'

/**
 * Every item, as rows: the folder's files, their variants and the layouts. Rebuilt only when the
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

  /** What's been loaded about an item's file (a variant has its source's; a layout has no file). */
  meta(e: Entry): AssetMeta | undefined {
    return e.kind === 'layout' ? undefined : library.meta.get(e.source ?? e.name)
  }

  /** An item with what's been loaded about its file. */
  asset(key: string | null | undefined): Asset | undefined {
    const e = this.entry(key)
    return e && withMeta(e, this.meta(e))
  }

  with(e: Entry): Asset {
    return withMeta(e, this.meta(e))
  }
}

export const items = new Items()
