import type { ExportPrefs } from '@shared/types'
import { api } from '../../lib/bridge'
import { renderImage, renderVideo, type Item, type Status } from './plan'

/**
 * One export run over a fixed list of files: images a few at a time, then videos one by one, with
 * each file's state and progress. Cancelling stops what's running and skips the rest; files already
 * written stay.
 */
export class ExportJob {
  items: Item[] = []
  status = $state<Record<string, Status>>({})
  finished = $state(false)
  cancelled = $state(false)
  readonly done = $derived(Object.values(this.status).filter((s) => s.state === 'done').length)
  readonly failed = $derived(Object.values(this.status).filter((s) => s.state === 'error').length)
  /** 0..1 over every file. */
  readonly progress = $derived(this.items.length ? this.items.reduce((acc, i) => acc + (this.status[i.id]?.progress ?? 0), 0) / this.items.length : 0)

  private out: string
  private prefs: ExportPrefs

  constructor(items: Item[], out: string, prefs: ExportPrefs) {
    this.items = items
    this.out = out
    this.prefs = prefs
    this.status = Object.fromEntries(items.map((i) => [i.id, { state: 'queued', progress: 0 } as Status]))
  }

  async run(): Promise<void> {
    const offProgress = api.onExportProgress(({ id, progress }) => {
      if (this.status[id]) this.update(id, { progress })
    })
    // Mark the destinations first, so files appearing there are never picked up as assets.
    await api.markOutput([this.out, ...new Set(this.items.map((i) => i.boardDir))]).catch(() => {})
    const queue = this.items.filter((i) => i.asset.kind === 'image')
    await Promise.all(
      Array.from({ length: 3 }, async () => {
        while (queue.length && !this.cancelled) await this.render(queue.shift()!)
      })
    )
    for (const v of this.items.filter((i) => i.asset.kind === 'video')) {
      if (this.cancelled) break
      await this.render(v)
    }
    offProgress()
    this.finished = true
    this.notify()
  }

  cancel(): void {
    this.cancelled = true
    api.cancelExport()
  }

  private update(id: string, s: Partial<Status>) {
    this.status[id] = { ...this.status[id], ...s }
  }

  private async render(item: Item) {
    if (this.cancelled) return
    this.update(item.id, { state: 'running' })
    try {
      if (item.asset.kind === 'image') await renderImage(item, this.prefs)
      else await renderVideo(item, this.prefs, () => this.cancelled)
      this.update(item.id, { state: 'done', progress: 1 })
    } catch (e) {
      if (this.cancelled) this.update(item.id, { state: 'queued', progress: 0 })
      else this.update(item.id, { state: 'error', error: String((e as Error).message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '') })
    }
  }

  /** Finished while you were in another app: tell the OS. */
  private notify() {
    if (this.cancelled || document.hasFocus()) return
    const n = new Notification(this.failed ? 'Export finished with errors' : 'Export complete', {
      body: this.failed ? `${this.done} exported, ${this.failed} failed` : `${this.done} file${this.done === 1 ? '' : 's'} exported`,
      silent: false
    })
    n.onclick = () => api.focusWindow()
  }
}
