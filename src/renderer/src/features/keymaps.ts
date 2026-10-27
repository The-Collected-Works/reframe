import { keymap } from '../lib/keymap.svelte'

/**
 * Every keyboard shortcut, by where it works. The app runs these (each view supplies what its
 * actions do) and the shortcuts panel lists them, so this is the one place to add or change one.
 */

export const GLOBAL = keymap({
  title: 'Global',
  actions: {
    openFolder: { keys: 'mod+o', label: 'Open folder', inFields: true, always: true },
    exportAll: { keys: 'mod+e', label: 'Export' },
    switchView: { keys: 'e', label: 'Grid / single view' },
    back: { keys: 'escape', label: 'Back to grid, deselect' },
    board: { keys: Array.from({ length: 9 }, (_, i) => `mod+${i + 1}`), show: 'mod+1–9', label: 'Switch artboard' },
    undo: { keys: 'mod+z', label: 'Undo' },
    redo: { keys: ['mod+shift+z', 'mod+y'], label: 'Redo' },
    selectAll: { keys: 'mod+a', label: 'Select all' },
    copy: { keys: 'mod+c', label: 'Copy settings' },
    paste: { keys: 'mod+v', label: 'Paste settings' },
    reset: { keys: 'mod+shift+r', label: 'Reset to defaults' },
    pick: { keys: 'i', label: 'Pick background color' }
  },
  notes: [
    { keys: 'Middle-click', label: 'Reset a value' },
    { keys: 'Middle-click', label: 'Delete an artboard (on its tab)' }
  ]
})

export const GRID = keymap({
  title: 'Grid',
  actions: {
    open: { keys: 'space', label: 'Open selected' },
    prev: { keys: 'arrowleft', label: 'Previous' },
    next: { keys: 'arrowright', label: 'Next' },
    up: { keys: 'arrowup', label: 'Row above' },
    down: { keys: 'arrowdown', label: 'Row below' },
    duplicate: { keys: 'mod+d', label: 'Duplicate' },
    combine: { keys: 'mod+g', label: 'Combine into a composition' },
    remove: { keys: ['delete', 'backspace'], show: 'delete', label: 'Delete a variant or composition' }
  },
  notes: [
    { keys: 'shift+Click', label: 'Select a range' },
    { keys: 'mod+Click', label: 'Add to selection' },
    { keys: 'Double-click', label: 'Open' },
    { keys: 'Drag', label: 'Move the media' },
    { keys: 'shift', label: 'Lock to an axis', section: 'While dragging' },
    { keys: 'alt', label: 'No snapping', section: 'While dragging' }
  ]
})

export const SINGLE = keymap({
  title: 'Single',
  actions: {
    play: { keys: 'space', label: 'Play / pause' },
    prev: { keys: ['arrowleft', 'arrowup'], label: 'Previous' },
    next: { keys: ['arrowright', 'arrowdown'], label: 'Next' },
    fit: { keys: 'mod+0', label: 'Fit to view' },
    zoomIn: { keys: ['mod+=', 'mod++'], show: 'mod++', label: 'Zoom in' },
    zoomOut: { keys: 'mod+-', label: 'Zoom out' },
    deselect: { keys: 'escape', label: 'Deselect, then back to grid' }
  },
  notes: [
    { keys: ['Scroll wheel', 'Pinch'], label: 'Zoom' },
    { keys: ['Two-finger scroll', 'Middle-drag'], label: 'Pan' },
    { keys: 'alt+Scroll', label: 'Scale media' },
    { keys: 'Double-click', label: 'Reset transform' },
    { keys: 'shift', label: 'Stretch (an edge or corner)', section: 'While dragging' },
    { keys: 'alt', label: 'Scale from the center', section: 'While dragging' },
    { keys: 'shift', label: 'Lock to an axis (moving)', section: 'While dragging' },
    { keys: 'shift', label: '15° steps (rotating)', section: 'While dragging' },
    { keys: 'mod', label: 'No snapping', section: 'While dragging' }
  ]
})

export const COMPOSITION_EDITOR = keymap({
  title: 'Composition editor',
  actions: {
    deselect: { keys: 'escape', label: 'Deselect the cell, then back to grid' },
    remove: { keys: ['delete', 'backspace'], show: 'delete', label: 'Remove the cell' }
  },
  notes: [
    { keys: 'Drag a gap', label: 'Resize the cells either side (this artboard)' },
    { keys: 'Click a cell', label: 'Frame what it shows' },
    { keys: 'Drag a cell’s tab', label: 'Swap it with another cell' },
    { keys: 'Right-click a cell', label: 'Add a cell, replace, remove' },
    { keys: 'alt', label: 'No snapping', section: 'While dragging a gap' }
  ]
})

/** In the order the shortcuts panel lists them. */
export const KEYMAPS = [GLOBAL, GRID, SINGLE, COMPOSITION_EDITOR]
