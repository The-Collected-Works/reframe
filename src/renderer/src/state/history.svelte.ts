/**
 * Undo and redo over an immutable value: each change replaces it, and the replaced one is kept.
 * Successive changes of the same kind in quick succession (the same `key`: one slider, one drag)
 * make one step; a change that changes nothing isn't recorded, so it can't clear redo.
 */
export class History<T> {
  current: T = $state.raw() as T
  private past = $state.raw<T[]>([])
  private future = $state.raw<T[]>([])
  private last = { at: 0, key: '' }

  constructor(
    initial: T,
    private readonly limit = 100
  ) {
    this.current = initial
  }

  /** Starts over from `value`, with nothing to undo or redo. */
  reset(value: T): void {
    this.current = value
    this.past = []
    this.future = []
    this.last = { at: 0, key: '' }
  }

  /** Records a change as an undo step (merged with the last one if `key` matches, briefly). */
  commit(next: T, key = ''): void {
    if (next === this.current) return
    const now = performance.now()
    const merge = !!key && key === this.last.key && now - this.last.at < 600
    this.last = { at: now, key }
    if (!merge) this.past = [...this.past.slice(1 - this.limit), this.current]
    this.current = next
    this.future = []
  }

  /** Changes the value without an undo step (for what undo shouldn't touch). */
  replace(next: T): void {
    this.current = next
  }

  /** Changes every value, present, past and future, as if it had always been so. */
  map(fn: (value: T) => T): void {
    this.past = this.past.map(fn)
    this.current = fn(this.current)
    this.future = this.future.map(fn)
  }

  /** Steps back; `carry` keeps parts of the present that undo shouldn't change. */
  undo(carry: (to: T, from: T) => T = (to) => to): boolean {
    const prev = this.past[this.past.length - 1]
    if (prev === undefined) return false
    this.last = { at: 0, key: '' }
    this.past = this.past.slice(0, -1)
    this.future = [this.current, ...this.future]
    this.current = carry(prev, this.current)
    return true
  }

  redo(carry: (to: T, from: T) => T = (to) => to): boolean {
    const next = this.future[0]
    if (next === undefined) return false
    this.last = { at: 0, key: '' }
    this.past = [...this.past, this.current]
    this.future = this.future.slice(1)
    this.current = carry(next, this.current)
    return true
  }
}
