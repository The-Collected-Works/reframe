/**
 * A change signal: the engine's only way out. Its classes say "something changed" and whoever is
 * listening reads what it needs (the Svelte adapter turns that into reactive state). `on()` gives
 * back a function that stops listening.
 */
export class Emitter {
  private fns = new Set<() => void>()

  on(fn: () => void): () => void {
    this.fns.add(fn)
    return () => void this.fns.delete(fn)
  }

  emit(): void {
    for (const fn of [...this.fns]) fn()
  }
}

/**
 * A change signal that fires once for any number of `emit()`s in the same task (on the next
 * microtask), so a burst of changes is one notification, and listeners never run in the middle of
 * the change that triggered them.
 */
export class BatchedEmitter extends Emitter {
  private queued = false

  override emit(): void {
    if (this.queued) return
    this.queued = true
    queueMicrotask(() => {
      this.queued = false
      super.emit()
    })
  }
}
