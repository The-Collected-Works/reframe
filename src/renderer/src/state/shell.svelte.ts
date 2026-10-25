/** What's open around the content right now. Not saved. */
class Shell {
  exportOpen = $state.raw(false)
  /** The artboard whose editor is open, if any. */
  editingBoard = $state.raw<string | null>(null)
  /** The artboard whose tab is being renamed in place, if any. */
  renamingBoard = $state.raw<string | null>(null)
  /** Eyedropper armed: the next click on the screen samples the background colour. */
  picking = $state.raw(false)
}

export const shell = new Shell()
