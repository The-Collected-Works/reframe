import type { Attachment } from 'svelte/attachments'
import { observeVisibility } from './lazydraw'

/** Moves the element to the end of document.body for as long as it exists. */
export const portal: Attachment<HTMLElement> = (node) => {
  document.body.appendChild(node)
  return () => node.remove()
}

/** Reports whether the element is on (or near) screen. */
export const visibility =
  (cb: (visible: boolean) => void): Attachment<Element> =>
  (node) =>
    observeVisibility(node, cb)

