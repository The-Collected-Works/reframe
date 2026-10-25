/** The main process, as the preload script exposes it (see src/preload). */
export const api = window.reframe

export const mac = api.platform === 'darwin'
export const win = api.platform === 'win32'

/** A local file as the renderer loads it: through the main process's `media:` protocol. */
export const mediaUrl = (path: string): string => 'media://f/' + encodeURIComponent(path)
