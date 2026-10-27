import { describe, expect, it } from 'vitest'
import { arrange } from '@shared/composition/bento'
import type { BentoNode } from '@shared/types'
import { dropAt } from './drop'

// row( a | col( b / c ) ) on 1000×500, 20 apart and 20 in from the edges.
const root: BentoNode = {
  id: 'r',
  dir: 'row',
  children: [
    { id: 'a', item: null },
    {
      id: 'g',
      dir: 'col',
      children: [
        { id: 'b', item: null },
        { id: 'c', item: null }
      ]
    }
  ]
}
const placed = arrange({ root, gap: 20, padding: 20 }, 1000, 500)
const at = (x: number, y: number, moving = 'c') => dropAt(root, placed, 1000, 500, { x, y }, moving)

describe('dropAt', () => {
  it('near a cell edge: beside it on that side', () => {
    expect(at(40, 250)).toMatchObject({ kind: 'beside', target: 'a', side: 'left' })
    expect(at(250, 470)).toMatchObject({ kind: 'beside', target: 'a', side: 'bottom' })
  })

  it("near a cell's middle: the two swap", () => {
    expect(at(250, 250)).toMatchObject({ kind: 'swap', target: 'a' })
  })

  it("a group can't swap: it goes beside", () => {
    expect(at(250, 250, 'g')).toMatchObject({ kind: 'beside', target: 'a' })
  })

  it('in a gap between cells: beside the nearest one', () => {
    expect(at(500, 250)).toMatchObject({ kind: 'beside', target: 'a', side: 'right' })
  })

  it('in the margin around the cells: beside the whole composition', () => {
    expect(at(500, 5)).toMatchObject({ kind: 'beside', target: 'r', side: 'top' })
  })

  it('nowhere inside what is being moved, nor off the artboard', () => {
    expect(at(700, 120, 'g')).toBeNull()
    expect(at(-5, 100)).toBeNull()
  })
})
