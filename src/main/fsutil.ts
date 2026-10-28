import { createHash } from 'node:crypto'
import { promises as fs, type Stats } from 'node:fs'

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

/** How much of a file's start, middle and end its content hash reads. */
const SAMPLE = 64 * 1024
/** Content hashes by path as the file was, so each file is read once for as long as it's unchanged. */
const hashes = new Map<string, string>()

/**
 * What's in a file, cheaply: its size and a hash of 64 KB from its start, middle and end (where a
 * video's header and index are). The same wherever the file is moved or however it's renamed;
 * different once it's edited.
 */
export async function contentHash(path: string, st: Stats): Promise<string> {
  const memo = `${path}|${st.size}|${st.mtimeMs}`
  let key = hashes.get(memo)
  if (!key) {
    const hash = createHash('sha1').update(`${st.size}|`)
    const fh = await fs.open(path, 'r')
    try {
      const n = Math.min(SAMPLE, st.size)
      for (const at of [0, Math.max(0, Math.floor(st.size / 2 - n / 2)), Math.max(0, st.size - n)]) {
        const buf = Buffer.alloc(n)
        const { bytesRead } = await fh.read(buf, 0, n, at)
        hash.update(buf.subarray(0, bytesRead))
      }
    } finally {
      await fh.close()
    }
    hashes.set(memo, (key = hash.digest('hex')))
  }
  return key
}
