/**
 * A drop target for files: `dropping` while files are dragged over it, `onFile` with the first one
 * dropped. Spread `handlers` onto the element. The tint goes when the drag leaves for anywhere
 * outside it (including off the window, where nothing is the related target); as a backstop,
 * dragover repeats every ~50ms while files are over it, so if that stops the drag has gone.
 */
export class FileDrop {
  dropping = $state(false)
  private idle: ReturnType<typeof setTimeout> | undefined

  constructor(private onFile: (file: File) => void) {}

  private end = () => {
    clearTimeout(this.idle)
    this.dropping = false
  }

  readonly handlers = {
    ondragover: (e: DragEvent) => {
      e.preventDefault()
      e.dataTransfer!.dropEffect = 'copy'
      this.dropping = true
      clearTimeout(this.idle)
      this.idle = setTimeout(this.end, 250)
    },
    ondragleave: (e: DragEvent) => {
      if (!(e.currentTarget as Element).contains(e.relatedTarget as Node | null)) this.end()
    },
    ondrop: (e: DragEvent) => {
      e.preventDefault()
      this.end()
      const file = e.dataTransfer?.files[0]
      if (file) this.onFile(file)
    }
  }
}

/** Elsewhere, files are refused (a not-allowed cursor) rather than opened by the browser, which would navigate away from the app. */
export function refuseDrop(e: DragEvent): void {
  if (e.defaultPrevented) return
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'none'
}
