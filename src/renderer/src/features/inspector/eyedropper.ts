import { edit } from '../../state/actions'
import { shell } from '../../state/shell.svelte'

/**
 * Picking the background colour from the media, with the app's own eyedropper (App shows it while
 * `shell.picking`). Grid thumbnails and the paused single-view frame are decoded exactly as export
 * decodes them, so their pixels are the real colours. While it's open, `picking` pauses playback
 * and hover previews, whose browser decode can be off.
 */
export function pickBackground(): void {
  shell.picking = !shell.picking
}

/** Closes the eyedropper, setting the colour it picked (null: cancelled). */
export function finishPick(hex: string | null): void {
  shell.picking = false
  if (hex) edit({ bg: 'color', bgColor: hex })
}
