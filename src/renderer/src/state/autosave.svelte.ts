import { untrack } from 'svelte'
import type { ProjectFile } from '@shared/types'
import { api } from '../lib/bridge'
import { library } from './library.svelte'
import { project } from './project.svelte'

/**
 * Saves the project next to its assets, shortly after edits settle. A save still waiting is written
 * straight away when another folder is opened, or by `flush` (the window closing). Opening or
 * reloading a project doesn't save it, nor does anything short of an edit to one from an earlier
 * format. Nothing is saved while it's locked: the main process refuses a save that would lose
 * something, and the project's lock then says why (see ProjectLock).
 * Call while the app initialises.
 */
export function autosave(): { flush: () => void } {
  let waiting: { dir: string; file: ProjectFile } | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  let dir: string | null = null
  let loads = 0
  const flush = () => {
    clearTimeout(timer)
    if (waiting) {
      const sent = waiting.dir
      api
        .saveProject(sent, waiting.file)
        .then((lock) => {
          if (lock && sent === library.dir) project.lock = lock
        })
        .catch(() => {})
    }
    waiting = null
  }
  $effect(() => {
    const next = { dir: library.dir, file: project.file }
    untrack(() => {
      if (next.dir !== dir) {
        dir = next.dir
        loads = project.loads
        return flush()
      }
      // Loaded (a reload): nothing to save, and an edit still waiting belonged to what it replaced.
      if (project.loads !== loads) {
        loads = project.loads
        waiting = null
        return clearTimeout(timer)
      }
      if (!next.dir || project.lock || project.upgrading) return
      waiting = { dir: next.dir, file: next.file }
      clearTimeout(timer)
      timer = setTimeout(flush, 400)
    })
  })
  $effect(() => flush)
  return { flush }
}
