import { describe, expect, it } from 'vitest'
import type { BentoNode, Split } from '../types'
import {
  arrange,
  canUngroup,
  dirsOn,
  flipSplit,
  insertBeside,
  moveInto,
  moveNode,
  reconcileWeights,
  removeNode,
  setSplitDir,
  ungroup,
  type DirOf
} from './bento'

/** A tree as text: slots by id, splits as row(…) / col(…) / auto(…). */
const show = (n: BentoNode): string => ('children' in n ? `${n.dir ?? 'auto'}(${n.children.map(show).join(' ')})` : n.id)
const slot = (id: string): BentoNode => ({ id, item: null })
const split = (id: string, dir: 'row' | 'col' | undefined, ...children: BentoNode[]): Split => ({ id, ...(dir ? { dir } : {}), children })

let n = 0
const newId = () => `s${++n}`
/** Directions as set, Auto splits running as rows. */
const dirOf: DirOf = (s) => s.dir ?? 'row'

describe('insertBeside', () => {
  it('builds three stacked beside a big one, a cell at a time', () => {
    n = 0
    let root: BentoNode = slot('L')
    root = insertBeside(root, 'L', 'left', slot('A'), dirOf, newId).root
    expect(show(root)).toBe('row(A L)')
    root = insertBeside(root, 'A', 'bottom', slot('B'), dirOf, newId).root
    expect(show(root)).toBe('row(col(A B) L)')
    // The column runs that way already: C joins it.
    root = insertBeside(root, 'B', 'bottom', slot('C'), dirOf, newId).root
    expect(show(root)).toBe('row(col(A B C) L)')
  })

  it('joins the split around the target when it runs the same way, and says what it was born from', () => {
    const r = insertBeside(split('r', 'row', slot('a'), slot('b')), 'a', 'right', slot('x'), dirOf, newId)
    expect(show(r.root)).toBe('row(a x b)')
    expect(r.born).toEqual({ id: 'x', from: 'a' })
  })

  it('goes by how an Auto split runs on the artboard', () => {
    const auto = split('r', undefined, slot('a'), slot('b'))
    expect(show(insertBeside(auto, 'a', 'top', slot('x'), () => 'col', newId).root)).toBe('auto(x a b)')
    expect(show(insertBeside(auto, 'a', 'top', slot('x'), () => 'row', newId).root)).toMatch(/^auto\(col\(x a\) b\)$/)
  })
})

describe('removeNode', () => {
  it('closes up behind a cell', () => {
    expect(show(removeNode(split('r', 'row', slot('a'), slot('b'), slot('c')), 'b')!)).toBe('row(a c)')
  })

  it('lets a split left with one child give way to it', () => {
    expect(show(removeNode(split('r', 'row', split('c', 'col', slot('a'), slot('b')), slot('d')), 'a')!)).toBe('row(b d)')
  })

  it('folds a group into the split around it when that leaves them running the same way', () => {
    // row( col( row(a b) x ) c ) minus x: the inner row joins the outer one.
    const root = split('r', 'row', split('c', 'col', split('i', 'row', slot('a'), slot('b')), slot('x')), slot('c'))
    expect(show(removeNode(root, 'x')!)).toBe('row(a b c)')
  })

  it('removing everything leaves nothing', () => {
    expect(removeNode(slot('a'), 'a')).toBeNull()
  })
})

describe('moveNode', () => {
  it('moves a cell beside another', () => {
    const root = split('r', 'row', slot('a'), slot('b'), slot('c'))
    expect(show(moveNode(root, 'a', 'c', 'right', dirOf, newId).root)).toBe('row(b c a)')
  })

  it('moves into a new stack', () => {
    const root = split('r', 'row', slot('a'), slot('b'), slot('c'))
    expect(show(moveNode(root, 'c', 'a', 'bottom', dirOf, newId).root)).toMatch(/^row\(col\(a c\) b\)$/)
  })

  it("won't move a group into itself", () => {
    const root = split('r', 'row', split('g', 'col', slot('a'), slot('b')), slot('c'))
    expect(moveNode(root, 'g', 'a', 'top', dirOf, newId).root).toBe(root)
  })

  it('moving one of a pair beside the pair goes beside what remains of it', () => {
    const root = split('r', 'row', split('g', 'col', slot('a'), slot('b')), slot('c'))
    expect(show(moveNode(root, 'a', 'g', 'right', dirOf, newId).root)).toBe('row(b a c)')
  })
})

describe('direction and grouping', () => {
  it('flips a split, and sets or clears its direction', () => {
    const root = split('r', 'row', slot('a'), slot('b'))
    expect(show(flipSplit(root, 'r', dirOf))).toBe('col(a b)')
    expect(show(setSplitDir(root, 'r', undefined))).toBe('auto(a b)')
  })

  it('ungroups a split into one running the same way, and only then', () => {
    const same = split('r', 'row', split('g', 'row', slot('a'), slot('b')), slot('c'))
    expect(canUngroup(same, 'g', dirOf)).toBe(true)
    expect(show(ungroup(same, 'g', dirOf))).toBe('row(a b c)')
    const across = split('r', 'row', split('g', 'col', slot('a'), slot('b')), slot('c'))
    expect(canUngroup(across, 'g', dirOf)).toBe(false)
    expect(ungroup(across, 'g', dirOf)).toBe(across)
  })

  it("an Auto split's direction comes from where it's placed", () => {
    const root = split('r', undefined, slot('a'), slot('b'))
    const layout = { root, gap: 0, padding: 0 }
    expect(dirsOn(arrange(layout, 1000, 500))(root)).toBe('row')
    expect(dirsOn(arrange(layout, 500, 1000))(root)).toBe('col')
    expect(dirsOn(arrange({ ...layout, root: { ...root, dir: 'row' } }, 500, 1000))({ ...root, dir: 'row' })).toBe('row')
  })
})

describe('reconcileWeights', () => {
  it('keeps shares through a removal, and drops a split that went', () => {
    const before = split('r', 'row', slot('a'), slot('b'), slot('c'))
    const after = removeNode(before, 'b')!
    expect(reconcileWeights(before, after, { r: { weights: [2, 1, 1] } })).toEqual({ r: { weights: [0.5, 0.25] } })
  })

  it('a cell added beside another takes half its share', () => {
    const before = split('r', 'row', slot('a'), slot('b'))
    const r = insertBeside(before, 'a', 'right', slot('x'), dirOf, newId)
    expect(reconcileWeights(before, r.root, { r: { weights: [3, 1] } }, r.born)).toEqual({ r: { weights: [0.375, 0.375, 0.25] } })
  })

  it('a new group takes the share of the cell it wrapped', () => {
    const before = split('r', 'row', slot('a'), slot('b'))
    const after = insertBeside(before, 'a', 'bottom', slot('x'), dirOf, newId).root
    expect(reconcileWeights(before, after, { r: { weights: [3, 1] } })).toEqual({ r: { weights: [0.75, 0.25] } })
  })

  it("a group's children spread into its parent keep their shares of the whole", () => {
    const before = split('r', 'row', split('g', 'row', slot('a'), slot('b')), slot('c'))
    const after = ungroup(before, 'g', dirOf)
    expect(reconcileWeights(before, after, { r: { weights: [1, 1] }, g: { weights: [1, 3] } })).toEqual({ r: { weights: [0.125, 0.375, 0.5] } })
  })

  it('leaves alone what had no proportions set', () => {
    const before = split('r', 'row', slot('a'), slot('b'))
    expect(reconcileWeights(before, removeNode(before, 'a')!, undefined)).toBeUndefined()
  })
})

describe('moveInto', () => {
  const tree = () => split('r', 'row', split('g', 'col', slot('a'), slot('b'), slot('c')), slot('d'))

  it('reorders within a group, as a layers list does', () => {
    expect(show(moveInto(tree(), 'c', 'g', 0))).toBe('row(col(c a b) d)')
    expect(show(moveInto(tree(), 'a', 'g', 3))).toBe('row(col(b c a) d)')
  })

  it('moves into another group', () => {
    expect(show(moveInto(tree(), 'd', 'g', 1))).toBe('col(a d b c)')
    expect(show(moveInto(tree(), 'b', 'r', 2))).toBe('row(col(a c) d b)')
  })

  it('closes up behind: a group left with one gives way to it', () => {
    const t = split('r', 'row', split('g', 'col', slot('a'), slot('b')), slot('d'))
    expect(show(moveInto(t, 'a', 'r', 2))).toBe('row(b d a)')
  })

  it('changes nothing moving a node to where it is, or a group into itself', () => {
    const t = tree()
    expect(moveInto(t, 'b', 'g', 1)).toBe(t)
    expect(moveInto(t, 'b', 'g', 2)).toBe(t)
    expect(moveInto(t, 'g', 'g', 0)).toBe(t)
  })
})
