import type { ReleaseNote, UpdateStatus } from '@shared/types'
import { api } from '../../lib/bridge'

export type Update = { version: string; notes: ReleaseNote[]; status: UpdateStatus }

/**
 * Checks for a newer release shortly after launch and every few hours; `current` is null until
 * there is one. The installed Windows app then downloads it itself, reporting progress as it goes.
 * Create it while a component initialises.
 */
export function updateCheck(): { readonly current: Update | null } {
  let current = $state<Update | null>(null)
  $effect(() => {
    const check = () => api.checkUpdate().then((u) => (current = u ?? null), () => {})
    const first = setTimeout(check, 3000)
    const every = setInterval(check, 6 * 60 * 60 * 1000)
    const off = api.onUpdateStatus((status) => {
      if (current) current = { ...current, status }
    })
    return () => {
      clearTimeout(first)
      clearInterval(every)
      off()
    }
  })
  return {
    get current() {
      return current
    }
  }
}
