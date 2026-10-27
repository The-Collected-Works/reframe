import { describe, expect, it } from 'vitest'
import { arrange } from '@shared/composition/bento'
import type { BentoNode } from '@shared/types'
import { dragGap } from './gaps'

const slot = (id: string): BentoNode => ({ id, item: null })
const none = () => null

describe('dragGap', () => {
  // Two cells beside a stack, each a third of 1200px.
  const root: BentoNode = { id: 'r', dir: 'row', children: [slot('a'), slot('b'), { id: 's', dir: 'col', children: [slot('x'), slot('y')] }] }
  const arrangement = arrange({ root, gap: 0, padding: 0 }, 1200, 600)
  const gap = arrangement.dividers.find((d) => d.split === 'r' && d.index === 1)!

  it('snaps everything before a gap to half the group', () => {
    const r = dragGap(arrangement, gap, 604, 1, none, false)
    expect(r.weights.map((w) => +w.toFixed(4))).toEqual([0.3333, 0.1667, 0.5])
    expect(r.readout).toContain('½')
  })

  it("doesn't snap when told not to", () => {
    const r = dragGap(arrangement, gap, 604, 1, none, true)
    expect(r.weights[2]).toBeCloseTo(596 / 1200)
  })
})
