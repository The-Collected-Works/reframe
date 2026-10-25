import { mac } from './paths'

/** Modifier names as each platform writes them. */
export const MOD = mac ? '⌘' : 'Ctrl'
export const SHIFT = mac ? '⇧' : 'Shift'
export const ALT = mac ? '⌥' : 'Alt'

/** A shortcut as text: "⌘⇧R" on macOS, "Ctrl+Shift+R" elsewhere. */
export const combo = (...keys: string[]): string => keys.join(mac ? '' : '+')
