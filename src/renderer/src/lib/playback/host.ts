import type { ColorMeta } from '@shared/types'

/**
 * What the playback engine needs from outside: the media worker (in the main process) that makes
 * playback copies and decodes exact frames, and how files are addressed. Passed in rather than
 * imported, so the engine runs against a fake in tests.
 */
export interface MediaHost {
  /** The address a file (an original, a copy, or a stream being written) is played from. */
  url(path: string): string
  /** Whether a copy can be played while it's made (see StreamFeed). */
  readonly streams: boolean
  /** Makes a copy (see ReframeApi.copy): its path, or null if it was stopped first. */
  copy(
    id: number,
    path: string,
    w: number,
    h: number,
    color: ColorMeta | undefined,
    edge: number,
    duration: number,
    background: boolean,
    stream: boolean
  ): Promise<string | null>
  /** Which of these copies are made already (their paths, or null). */
  copiesMade(list: { path: string; edge: number }[]): Promise<(string | null)[]>
  /** Stops copy `id` (as given to `copy`); its `copy` call gives null. */
  cancelCopy(id: number): unknown
  onCopyProgress(cb: (p: { id: number; progress: number; stream?: string }) => void): () => void
  /** An exact frame as JPEG (see ReframeApi.frame); null when a newer request with the same tag replaced it. */
  frame(path: string, time: number, color: ColorMeta | undefined, tag: string, edge: number): Promise<Uint8Array | null>
}
