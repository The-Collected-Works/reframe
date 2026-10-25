import type { Binding } from '../lib/keymap.svelte'
import { library } from '../state/library.svelte'
import { project } from '../state/project.svelte'
import { selection } from '../state/selection.svelte'
import { shell } from '../state/shell.svelte'
import { view } from '../state/view.svelte'
import { clearSelection, copy, openFolder, paste, redo, resetSelection, setMode, undo } from '../state/actions'
import { pickBackground } from './inspector/eyedropper'

/**
 * The app-wide keyboard shortcuts. The grid and the single view add their own while they're showing
 * (arrows, Space, zoom), and the single view's stage takes Esc while its media is selected. The
 * list in AppInfo is what users see; keep it in step.
 */
export const SHORTCUTS: Binding[] = [
  { keys: 'mod+o', run: () => openFolder(), inFields: true, always: true },
  { keys: 'mod+z', run: undo },
  { keys: ['mod+shift+z', 'mod+y'], run: redo },
  { keys: 'mod+a', run: () => selection.selectAll() },
  { keys: 'mod+c', run: copy },
  { keys: 'mod+v', run: paste },
  { keys: 'mod+e', run: () => (shell.exportOpen = true) },
  { keys: 'mod+shift+r', run: resetSelection },
  ...Array.from({ length: 9 }, (_, i) => ({
    keys: `mod+${i + 1}`,
    when: () => i < project.file.artboards.length,
    run: () => (project.boardId = project.file.artboards[i].id)
  })),
  { keys: 'i', run: pickBackground },
  { keys: 'e', run: () => setMode(view.mode === 'single' ? 'grid' : 'single') },
  { keys: 'escape', run: () => (view.mode === 'single' ? setMode('grid') : clearSelection()) }
]

/** Nothing but opening a folder until one is open, or while the export dialog is. */
export const blocked = (): boolean => !library.dir || shell.exportOpen

/** An artboard's editor is open: plain keys are its own. */
export const quiet = (): boolean => !!shell.editingBoard
