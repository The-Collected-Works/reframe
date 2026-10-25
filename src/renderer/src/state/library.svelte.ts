import { SvelteMap } from 'svelte/reactivity'
import type { AssetEntry, ColorMeta, FolderScan, SkippedFolder } from '@shared/types'
import { hydrate } from './loading'
import { folderOf } from './model/tree'

/**
 * What loading an asset finds out (size, timing, colour, thumbnail). Kept apart from the scanned
 * list, so thumbnails arriving never change the list everything is sorted and laid out from; each
 * thumbnail reads its own entry.
 */
export interface AssetMeta {
  w: number
  h: number
  duration: number
  color?: ColorMeta
  audio?: boolean
  /** Video frame rate; 0 if unknown. */
  fps?: number
  thumb: ImageBitmap | null
  error: boolean
}

/** A scanned asset together with what's been loaded about it. */
export type Asset = AssetEntry & AssetMeta

const NO_META: AssetMeta = { w: 0, h: 0, duration: 0, thumb: null, error: false }

export const withMeta = (entry: AssetEntry, meta: AssetMeta | undefined): Asset => ({ ...entry, ...(meta ?? NO_META) })

/** The open folder: its images and videos (in folder order), and what's been loaded about each. */
class Library {
  dir = $state.raw<string | null>(null)
  assets = $state.raw<AssetEntry[]>([])
  /** By asset name; each entry is reactive on its own. */
  readonly meta = new SvelteMap<string, AssetMeta>()
  /** Subfolders the scan left out (exports, or excluded by the user). */
  skipped = $state.raw<SkippedFolder[]>([])
  /** The scan stopped at its file limit. */
  truncated = $state.raw(false)

  /** Every folder that holds assets, including ones that only hold other folders. */
  readonly folders = $derived.by(() => {
    const folders = new Set<string>()
    for (const a of this.assets) for (let f = folderOf(a.name); f; f = folderOf(f)) folders.add(f)
    return [...folders]
  })

  /** A newly opened folder: nothing known about the last one carries over. */
  open(scan: FolderScan): void {
    this.dir = scan.dir
    this.assets = scan.assets
    this.meta.clear()
    this.skipped = scan.skipped
    this.truncated = scan.truncated
    hydrate(scan.assets, true)
  }

  /** The same folder scanned again: unchanged files keep what's been loaded for them. */
  rescan(scan: FolderScan): void {
    const next = new Map(scan.assets.map((a) => [a.name, a]))
    for (const prev of this.assets) {
      const e = next.get(prev.name)
      if (!e || prev.mtime !== e.mtime || prev.size !== e.size) this.meta.delete(prev.name)
    }
    this.assets = scan.assets
    this.skipped = scan.skipped
    this.truncated = scan.truncated
    hydrate(
      scan.assets.filter((e) => !this.meta.has(e.name)),
      false
    )
  }

  /** Records what loading found, if `entry` is still the asset of that name (not a replaced file). */
  setMeta(entry: AssetEntry, patch: Partial<AssetMeta>): void {
    const current = this.assets.find((a) => a.name === entry.name)
    if (!current || current.path !== entry.path || current.mtime !== entry.mtime) return
    this.meta.set(entry.name, { ...NO_META, ...this.meta.get(entry.name), ...patch })
  }

  /** An asset with what's been loaded about it. */
  asset(name: string | null): Asset | undefined {
    const entry = name ? this.assets.find((a) => a.name === name) : undefined
    return entry && withMeta(entry, this.meta.get(entry.name))
  }
}

export const library = new Library()
