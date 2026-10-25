import type { Handler } from '../lib/keymap.svelte'
import { library } from '../state/library.svelte'
import { project } from '../state/project.svelte'
import { selection } from '../state/selection.svelte'
import { shell } from '../state/shell.svelte'
import { view } from '../state/view.svelte'
import { clearSelection, copy, openFolder, paste, redo, resetSelection, setMode, undo } from '../state/actions'
import { pickBackground } from './inspector/eyedropper'
import type { GLOBAL } from './keymaps'

type Actions = keyof typeof GLOBAL.actions

/** What the app-wide shortcuts do (see keymaps.ts). */
export const GLOBAL_HANDLERS: Record<Actions, Handler> = {
  openFolder: () => openFolder(),
  exportAll: () => (shell.exportOpen = true),
  switchView: () => setMode(view.mode === 'single' ? 'grid' : 'single'),
  back: () => (view.mode === 'single' ? setMode('grid') : clearSelection()),
  board: (e) => {
    const b = project.file.artboards[Number(e.key) - 1]
    if (b) project.boardId = b.id
  },
  undo,
  redo,
  selectAll: () => selection.selectAll(),
  copy,
  paste,
  reset: resetSelection,
  pick: pickBackground
}

/** Nothing but opening a folder until one is open, or while the export dialog is. */
export const blocked = (): boolean => !library.dir || shell.exportOpen

/** An artboard's editor is open: plain keys are its own. */
export const quiet = (): boolean => !!shell.editingBoard
