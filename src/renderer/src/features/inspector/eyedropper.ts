import { edit } from '../../state/actions'
import { shell } from '../../state/shell.svelte'

type EyeDropperCtor = new () => { open(options?: { signal?: AbortSignal }): Promise<{ sRGBHex: string }> }

let pickAbort: AbortController | null = null

export function cancelPick(): void {
  pickAbort?.abort()
}

/**
 * Native eyedropper for the background colour. Grid thumbnails and the paused single-view frame
 * are decoded exactly as export decodes them, so screen pixels there are the real colours. While
 * it's open, `picking` pauses playback and hover previews, whose browser decode can be off.
 */
export async function pickBackground(): Promise<void> {
  const EyeDropper = (window as unknown as { EyeDropper?: EyeDropperCtor }).EyeDropper
  if (!EyeDropper || shell.picking) return
  shell.picking = true
  pickAbort = new AbortController()
  try {
    const { sRGBHex } = await new EyeDropper().open({ signal: pickAbort.signal })
    if (/^#[0-9a-f]{6}$/i.test(sRGBHex)) edit({ bg: 'color', bgColor: sRGBHex.toLowerCase() })
  } catch {
    // Cancelled.
  } finally {
    pickAbort = null
    shell.picking = false
  }
}
