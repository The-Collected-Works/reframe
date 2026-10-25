import { untrack } from 'svelte'
import type { ProjectFile } from '@shared/types'
import { api } from '../lib/bridge'
import { library } from './library.svelte'
import { project } from './project.svelte'

/**
 * Saves the project next to its assets, shortly after edits settle. A save still waiting is written
 * straight away when another folder is opened, or by `flush` (the window closing). Opening a folder
 * doesn't save it. Call while the app initialises.
 */
export function autosave(): { flush: () => void } {
  let waiting: { dir: string; file: ProjectFile } | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  let dir: string | null = null
  const flush = () => {
    clearTimeout(timer)
    if (waiting) api.saveProject(waiting.dir, waiting.file).catch(() => {})
    waiting = null
  }
  $effect(() => {
    const next = { dir: library.dir, file: project.file }
    untrack(() => {
      if (next.dir !== dir) {
        dir = next.dir
        return flush()
      }
      if (!next.dir) return
      waiting = { dir: next.dir, file: next.file }
      clearTimeout(timer)
      timer = setTimeout(flush, 400)
    })
  })
  $effect(() => flush)
  return { flush }
}
