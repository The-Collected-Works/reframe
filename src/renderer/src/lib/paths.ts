import { api } from '../state/loading'

/** File paths as the OS writes them. Asset and folder names in the project are "/"-separated. */
export const mac = api.platform === 'darwin'
const win = api.platform === 'win32'
export const sep = win ? '\\' : '/'

export const join = (...parts: string[]): string =>
  parts.map((p, i) => (i ? p.replace(/^[\\/]+/, '') : p.replace(/[\\/]+$/, ''))).join(sep)

/** A project folder ("Shoot A/Day 2", or "" for the top) as a path inside `dir`. */
export const inside = (dir: string, folder: string): string => (folder ? join(dir, ...folder.split('/')) : dir)

/** The last part of a path: the folder or file name. */
export const basename = (path: string): string => path.split(/[\\/]/).filter(Boolean).pop() ?? path

/** Whether two paths name the same folder: case-insensitively where the file system usually is. */
export function samePath(a: string, b: string): boolean {
  const norm = (p: string) => p.replace(/[\\/]+$/, '')
  return win || mac ? norm(a).toLowerCase() === norm(b).toLowerCase() : norm(a) === norm(b)
}
