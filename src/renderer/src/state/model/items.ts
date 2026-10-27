import { autoDir, arrange, mapNode, parentOf, slotKey, slotsOf, type Dir } from '@shared/composition/bento'
import type {
  Artboard,
  AssetEntry,
  CropSettings,
  CompositionItem,
  BentoNode,
  Slot,
  MediaKind,
  ProjectFile,
  SplitArrangement,
  VariantItem,
  VirtualItem
} from '@shared/types'
import { uid } from './project'
import { baseName, folderOf } from './tree'

/**
 * Variants and compositions: items that aren't files. Each has a key of its own ("~" and a random id, which
 * never has a file extension, so it can't be a file's name) and is a row like any asset: framed per
 * artboard through the artboard's overrides, trimmed through the project's clips. Plain data in,
 * plain data out.
 */

export const isVirtual = (key: string): boolean => key.startsWith('~')

/** Each type of composition, as it's called on screen. */
export const COMPOSITION_TYPES: Record<CompositionItem['type'], string> = { bento: 'Bento' }

/** A row in the library: a file, a variant of one, or a composition. */
export interface Entry {
  /** Its key: a file's name (its path from the open folder), or a variant's or composition's key. */
  name: string
  kind: MediaKind | 'composition'
  /** What it's called on screen: a file's name, a variant's or a composition's own. */
  label: string
  /** The file it shows (a variant's source's); none for a composition. */
  path: string
  size: number
  mtime: number
  /** A variant: the name of the file it's of. */
  source?: string
}

/**
 * Every row: the compositions, then the folder's files in folder order, each followed by its variants.
 * Variants of files that have gone aren't shown (their settings stay, should the file come back).
 */
export function entriesOf(files: AssetEntry[], items: Record<string, VirtualItem>): Entry[] {
  const compositions: Entry[] = []
  const variants = new Map<string, Entry[]>()
  const byName = new Map(files.map((f) => [f.name, f]))
  for (const [key, item] of Object.entries(items)) {
    if (item.kind === 'composition') compositions.push({ name: key, kind: 'composition', label: item.name, path: '', size: 0, mtime: 0 })
    else {
      const f = byName.get(item.source)
      if (!f) continue
      const list = variants.get(f.name) ?? []
      list.push({ ...f, name: key, label: item.name, source: f.name })
      variants.set(f.name, list)
    }
  }
  const out = [...compositions]
  for (const f of files) out.push({ ...f, label: baseName(f.name) }, ...(variants.get(f.name) ?? []))
  return out
}
const newKey = (): string => '~' + uid()

export const itemsOf = (file: ProjectFile): Record<string, VirtualItem> => file.items ?? {}

export function compositionOf(file: ProjectFile, key: string | null | undefined): CompositionItem | null {
  const item = key ? itemsOf(file)[key] : undefined
  return item?.kind === 'composition' ? item : null
}

export function variantOf(file: ProjectFile, key: string): VariantItem | null {
  const item = itemsOf(file)[key]
  return item?.kind === 'variant' ? item : null
}

/** The file an item shows: its own name for a file, its source for a variant (compositions show several). */
export const fileOf = (file: ProjectFile, key: string): string | null => (isVirtual(key) ? (variantOf(file, key)?.source ?? null) : key)

const stem = (name: string) => baseName(name).replace(/\.[^.]+$/, '')

/** `base`, or "base 2", "base 3"… whichever isn't taken. */
function unique(base: string, taken: Set<string>): string {
  if (!taken.has(base.toLowerCase())) return base
  let n = 2
  while (taken.has(`${base} ${n}`.toLowerCase())) n++
  return `${base} ${n}`
}

/** A board with `fn` applied to the overrides of `key` (null removes them). */
function withOverride(b: Artboard, key: string, o: Partial<CropSettings> | null): Artboard {
  const overrides = { ...b.overrides }
  if (o && Object.keys(o).length) overrides[key] = o
  else delete overrides[key]
  return { ...b, overrides }
}

/**
 * Copies of items: a variant of a file (or of the file a variant shows) with the same framing and
 * trim, or a composition with the same arrangement. A copy is only exported on `boardId` at first: everywhere
 * else it would be an exact duplicate of its original.
 */
export function duplicate(file: ProjectFile, keys: string[], boardId: string): { file: ProjectFile; keys: string[] } {
  const items = { ...itemsOf(file) }
  const clips = { ...file.clips }
  let boards = file.artboards
  const made: string[] = []
  for (const from of keys) {
    const key = newKey()
    const composition = compositionOf(file, from)
    // Slot ids are fresh in the copy; framings and arrangements follow them over.
    const ids = new Map<string, string>()
    if (composition) {
      const copyNode = (n: BentoNode): BentoNode => {
        const id = uid()
        ids.set(n.id, id)
        return 'children' in n ? { id, children: n.children.map(copyNode) } : { ...n, id }
      }
      const taken = new Set(Object.values(items).map((i) => i.name.toLowerCase()))
      items[key] = { ...composition, name: unique(`${composition.name} copy`, taken), root: copyNode(composition.root) }
    } else {
      const source = fileOf(file, from)
      if (!source) continue
      const folder = folderOf(source)
      const taken = new Set(
        Object.values(items)
          .filter((i): i is VariantItem => i.kind === 'variant' && folderOf(i.source) === folder)
          .map((i) => i.name.toLowerCase())
      )
      const name = isVirtual(from) ? variantOf(file, from)!.name : stem(source)
      items[key] = { kind: 'variant', source, name: unique(`${name} copy`, taken) }
      if (clips[from]) clips[key] = clips[from]
    }
    boards = boards.map((b) => {
      let next = withOverride(b, key, { ...b.overrides[from], ...(b.id === boardId ? {} : { skip: true }) })
      for (const [old, id] of ids) {
        if (b.overrides[slotKey(from, old)]) next = withOverride(next, slotKey(key, id), b.overrides[slotKey(from, old)])
      }
      const splits = b.splits?.[from]
      if (splits) next = { ...next, splits: { ...next.splits, [key]: Object.fromEntries(Object.entries(splits).map(([id, s]) => [ids.get(id) ?? id, s])) } }
      return next
    })
    made.push(key)
  }
  return { file: { ...file, items, clips, artboards: boards }, keys: made }
}

/**
 * Removes variants and compositions, with their framings, trims and arrangements. Compositions that showed a
 * removed item keep the slot, empty.
 */
export function remove(file: ProjectFile, keys: string[]): ProjectFile {
  const gone = new Set(keys.filter(isVirtual))
  if (!gone.size) return file
  const items: Record<string, VirtualItem> = {}
  for (const [key, item] of Object.entries(itemsOf(file))) {
    if (gone.has(key)) continue
    if (item.kind !== 'composition') items[key] = item
    else {
      let root = item.root
      for (const s of slotsOf(root)) if (s.item && gone.has(s.item)) root = mapNode(root, s.id, (n) => ({ ...n, item: null }))
      items[key] = root === item.root ? item : { ...item, root }
    }
  }
  // The item's own framings, and its slots' ("~composition/slot").
  const owned = (k: string) => gone.has(k) || (isVirtual(k) && gone.has(k.slice(0, k.indexOf('/'))))
  const clips = Object.fromEntries(Object.entries(file.clips).filter(([k]) => !gone.has(k)))
  const artboards = file.artboards.map((b) => ({
    ...b,
    overrides: Object.fromEntries(Object.entries(b.overrides).filter(([k]) => !owned(k))),
    ...(b.splits ? { splits: Object.fromEntries(Object.entries(b.splits).filter(([k]) => !gone.has(k))) } : {})
  }))
  return { ...file, items, clips, artboards }
}

/** How many compositions show any of `keys`. */
export const compositionsShowing = (file: ProjectFile, keys: string[]): number =>
  Object.values(itemsOf(file)).filter((i) => i.kind === 'composition' && slotsOf(i.root).some((s) => s.item && keys.includes(s.item))).length

/** Balanced to start: up to three side by side, beyond that in groups of about √n. */
function autoTree(members: string[]): BentoNode {
  const leaf = (item: string): Slot => ({ id: uid(), item })
  if (members.length === 1) return leaf(members[0])
  if (members.length <= 3) return { id: uid(), children: members.map(leaf) }
  const groups = Math.round(Math.sqrt(members.length))
  const size = Math.floor(members.length / groups)
  const extra = members.length % groups
  const children: BentoNode[] = []
  let at = 0
  for (let g = 0; g < groups; g++) {
    const n = size + (g < extra ? 1 : 0)
    const part = members.slice(at, at + n)
    at += n
    children.push(part.length === 1 ? leaf(part[0]) : { id: uid(), children: part.map(leaf) })
  }
  return { id: uid(), children }
}

/** A new composition of `members` (in that order), exported on every artboard. */
export function combine(file: ProjectFile, members: string[], bgColor: string): { file: ProjectFile; key: string } {
  const key = newKey()
  const taken = new Set(Object.values(itemsOf(file)).map((i) => i.name.toLowerCase()))
  let n = 1
  while (taken.has(`composition ${n}`)) n++
  const composition: CompositionItem = {
    kind: 'composition',
    type: 'bento',
    name: `Composition ${n}`,
    root: autoTree(members),
    gap: 16,
    padding: 16,
    radius: 0,
    bgColor,
    duration: null
  }
  return { file: { ...file, items: { ...itemsOf(file), [key]: composition } }, key }
}

/** Adds `members` to the end of a composition. */
export function append(file: ProjectFile, key: string, members: string[]): ProjectFile {
  const composition = compositionOf(file, key)
  if (!composition || !members.length) return file
  const fresh = members.map((item): Slot => ({ id: uid(), item }))
  const root: BentoNode =
    'children' in composition.root
      ? { ...composition.root, children: [...composition.root.children, ...fresh] }
      : { id: uid(), children: [composition.root, ...fresh] }
  // Where the outer split's proportions were set, the newcomers get an average share.
  const artboards = file.artboards.map((b) => {
    const w = b.splits?.[key]?.[composition.root.id]?.weights
    if (root.id !== composition.root.id || !w || w.length !== (composition.root as { children: unknown[] }).children.length) return b
    const avg = w.reduce((a, x) => a + x, 0) / w.length
    return withSplit(b, key, root.id, { weights: [...w, ...fresh.map(() => avg)] })
  })
  return withComposition({ ...file, artboards }, key, { root })
}

/** A variant or composition with a new name. */
export function rename(file: ProjectFile, key: string, name: string): ProjectFile {
  const item = itemsOf(file)[key]
  return item && item.name !== name ? { ...file, items: { ...itemsOf(file), [key]: { ...item, name } } } : file
}

export function withComposition(file: ProjectFile, key: string, patch: Partial<CompositionItem>): ProjectFile {
  const composition = compositionOf(file, key)
  return composition ? { ...file, items: { ...itemsOf(file), [key]: { ...composition, ...patch } } } : file
}

/** A board with one split's arrangement changed (null: back to following the artboard). */
export function withSplit(b: Artboard, composition: string, split: string, set: SplitArrangement | null): Artboard {
  const forComposition = { ...b.splits?.[composition] }
  if (set && (set.dir || set.weights)) forComposition[split] = { ...forComposition[split], ...set }
  else delete forComposition[split]
  const splits = { ...b.splits }
  if (Object.keys(forComposition).length) splits[composition] = forComposition
  else delete splits[composition]
  return { ...b, splits }
}

/**
 * Adds an empty slot beside a slot (`dir` row) or below it (col), as it's arranged on `boardId`:
 * into the same split if that already runs that way there, or else splitting the slot in two.
 */
export function splitSlot(file: ProjectFile, key: string, slotId: string, dir: Dir, boardId: string): { file: ProjectFile; slot: string } {
  const composition = compositionOf(file, key)!
  const board = file.artboards.find((b) => b.id === boardId)!
  const placed = arrange(composition, board.width, board.height, board.splits?.[key])
  const parent = parentOf(composition.root, slotId)
  const fresh: Slot = { id: uid(), item: null }
  if (parent && placed.splits.get(parent.id)?.dir === dir) {
    const i = parent.children.findIndex((c) => c.id === slotId)
    const root = mapNode(composition.root, parent.id, (p) => ({ ...p, children: [...parent.children.slice(0, i + 1), fresh, ...parent.children.slice(i + 1)] }))
    // Where the split's proportions were set, the slot's share is halved between it and the new one.
    const artboards = file.artboards.map((b) => {
      const w = b.splits?.[key]?.[parent.id]?.weights
      if (!w || w.length !== parent.children.length) return b
      return withSplit(b, key, parent.id, { weights: [...w.slice(0, i), w[i] / 2, w[i] / 2, ...w.slice(i + 1)] })
    })
    return { file: withComposition({ ...file, artboards }, key, { root }), slot: fresh.id }
  }
  const id = uid()
  const root = mapNode(composition.root, slotId, (s) => ({ id, children: [s, fresh] }))
  // On this artboard it runs the way asked (if that isn't how it would run anyway); elsewhere it
  // follows each artboard's shape.
  const cell = placed.cells.find((c) => c.slot.id === slotId)!
  const artboards = autoDir(cell.rect) === dir ? file.artboards : file.artboards.map((b) => (b.id === boardId ? withSplit(b, key, id, { dir }) : b))
  return { file: withComposition({ ...file, artboards }, key, { root }), slot: fresh.id }
}

/** Removes a slot (its split closes up behind it); the only slot left is emptied instead. */
export function removeSlot(file: ProjectFile, key: string, slotId: string): ProjectFile {
  const composition = compositionOf(file, key)!
  const parent = parentOf(composition.root, slotId)
  let artboards = file.artboards.map((b) => withOverride(b, slotKey(key, slotId), null))
  if (!parent) return withComposition({ ...file, artboards }, key, { root: { ...(composition.root as Slot), item: null } })
  const i = parent.children.findIndex((c) => c.id === slotId)
  const rest = parent.children.filter((c) => c.id !== slotId)
  const root = mapNode(composition.root, parent.id, (p) => (rest.length === 1 ? rest[0] : { ...p, children: rest }))
  artboards = artboards.map((b) => {
    const w = b.splits?.[key]?.[parent.id]?.weights
    if (rest.length === 1) return withSplit(b, key, parent.id, null)
    return w && w.length === parent.children.length ? withSplit(b, key, parent.id, { weights: w.filter((_, j) => j !== i) }) : b
  })
  return withComposition({ ...file, artboards }, key, { root })
}

/** Swaps what two slots show, framing and all. */
export function swapSlots(file: ProjectFile, key: string, a: string, b: string): ProjectFile {
  const composition = compositionOf(file, key)
  if (!composition || a === b) return file
  const sa = slotsOf(composition.root).find((s) => s.id === a)!
  const sb = slotsOf(composition.root).find((s) => s.id === b)!
  let root = mapNode(composition.root, a, () => ({ ...sb, id: a }))
  root = mapNode(root, b, () => ({ ...sa, id: b }))
  const artboards = file.artboards.map((board) => {
    const oa = board.overrides[slotKey(key, a)] ?? null
    const ob = board.overrides[slotKey(key, b)] ?? null
    return withOverride(withOverride(board, slotKey(key, a), ob), slotKey(key, b), oa)
  })
  return withComposition({ ...file, artboards }, key, { root })
}

/** Changes what a slot shows; framing set for what it showed before goes. */
export function setSlot(file: ProjectFile, key: string, slotId: string, patch: Partial<Omit<Slot, 'id'>>): ProjectFile {
  const composition = compositionOf(file, key)
  if (!composition) return file
  const root = mapNode(composition.root, slotId, (s) => ({ ...s, ...patch }))
  const artboards = 'item' in patch ? file.artboards.map((b) => withOverride(b, slotKey(key, slotId), null)) : file.artboards
  return withComposition({ ...file, artboards }, key, { root })
}
