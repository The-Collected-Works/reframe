/** What's open around the content right now. Not saved. */
class Shell {
  exportOpen = $state.raw(false)
  /** The artboard whose editor is open, if any. */
  editingBoard = $state.raw<string | null>(null)
  /** The artboard whose tab is being renamed in place, if any. */
  renamingBoard = $state.raw<string | null>(null)
  /** A composition's cell whose picture is being adjusted (moved, scaled, rotated in its cell), if any. */
  adjusting = $state.raw<string | null>(null)
  /** A composition's slot whose content is being chosen (the picker is open). */
  choosing = $state.raw<string | null>(null)
  /** A variant or composition being renamed in place, if any. */
  renamingItem = $state.raw<string | null>(null)
  /** Eyedropper armed: the next click on the screen samples the background colour. */
  picking = $state.raw(false)
  /** Which assets the last export went for, so the next starts there (trying settings on one asset stays on it). */
  exportScope = $state.raw<ExportScope | null>(null)
}

export type ExportScope = 'all' | 'visible' | 'selected'

export const shell = new Shell()
