import { promises as fs } from 'node:fs'

const queues = new Map<string, Promise<unknown>>()
let seq = 0

/**
 * Writes a file so a reader never sees it half-written: to a uniquely named temporary file, then
 * renamed over the target. Writes to the same file run one after another, so overlapping saves
 * can't trip over each other's temporary file or land out of order.
 */
export function writeFileAtomic(path: string, text: string): Promise<void> {
  const write = async () => {
    const tmp = `${path}.${process.pid}.${++seq}.tmp`
    try {
      await fs.writeFile(tmp, text)
      await fs.rename(tmp, path)
    } catch (e) {
      await fs.rm(tmp, { force: true })
      throw e
    }
  }
  const next = (queues.get(path) ?? Promise.resolve()).catch(() => {}).then(write)
  queues.set(path, next)
  next.finally(() => queues.get(path) === next && queues.delete(path)).catch(() => {})
  return next
}

/** writeFileAtomic, as JSON. */
export function writeJsonAtomic(path: string, data: unknown, pretty = false): Promise<void> {
  return writeFileAtomic(path, JSON.stringify(data, null, pretty ? 2 : undefined))
}
