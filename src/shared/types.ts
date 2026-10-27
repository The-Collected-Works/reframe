export type FitMode = 'fill' | 'fit' | 'width' | 'height' | 'stretch'
export type BgMode = 'color' | 'blur'
export type MediaKind = 'image' | 'video'

/** Per-artboard crop settings. Defaults live on the artboard; assets override any subset. */
export interface CropSettings {
  fit: FitMode
  /** Multiplier on the fit scale. 1 = exactly fit/fill. */
  zoom: number
  /** Stretch along the media's own width / height (from dragging an edge). 1 = none. */
  scaleX: number
  scaleY: number
  /** Where the media sits within the free space, 0..1 (like CSS object-position). */
  anchorX: number
  anchorY: number
  /** Extra offset as a fraction of artboard width/height. */
  offsetX: number
  offsetY: number
  /** Degrees, clockwise. */
  rotation: number
  flipX: boolean
  flipY: boolean
  bg: BgMode
  bgColor: string
  /** Gaussian sigma in artboard pixels for the blurred background. */
  blur: number
  mute: boolean
  skip: boolean
}

export type SettingKey = keyof CropSettings

export interface Artboard {
  id: string
  name: string
  width: number
  height: number
  defaults: CropSettings
  /** Keyed by item: an asset's file name, a variant's key, or a composition slot's (see arrangement.ts). */
  overrides: Record<string, Partial<CropSettings>>
  /** How compositions are arranged on this artboard: by composition key, then split id. Unset follows its shape. */
  splits?: Record<string, Record<string, SplitArrangement>>
}

/** A cell in a bento composition, showing an item (or nothing yet). */
export interface Slot {
  id: string
  item: string | null
  /** A video shorter than the composition: plays again from its start, or holds its last frame. */
  end?: 'loop' | 'hold'
}

/** In a bento: its children side by side or stacked, whichever way suits the space it gets on each artboard. */
export interface Split {
  id: string
  children: BentoNode[]
}

export type BentoNode = Slot | Split

/** How one split sits on one artboard. Either part left unset follows the artboard. */
export interface SplitArrangement {
  dir?: 'row' | 'col'
  /** Each child's share of the space, in any unit. */
  weights?: number[]
}

/**
 * Items that aren't files: a variant (a file again, with its own framing and trim) or a composition
 * (several items put together on one artboard). Each is a row of its own, keyed apart from file names.
 */
export interface VariantItem {
  kind: 'variant'
  /** The file's name. */
  source: string
  name: string
}

/**
 * A composition: several items put together, each a layer with its own place and timing. Its `type`
 * says how they're put together; each type has its own fields. So far there's one:
 * - `bento`: cells laid out as a tree of splits, with gaps between them (see composition/bento.ts).
 */
export type CompositionItem = BentoComposition

export interface BentoComposition {
  kind: 'composition'
  type: 'bento'
  name: string
  root: BentoNode
  /** In artboard pixels: between cells, and around them. */
  gap: number
  padding: number
  /** Corner radius of each cell, in artboard pixels. */
  radius: number
  bgColor: string
  /** Seconds; null: as long as its longest video. */
  duration: number | null
}

export type VirtualItem = VariantItem | CompositionItem

export interface Clip {
  start: number
  end: number | null
}

export interface ExportPrefs {
  dir: string | null
  imageFormat: 'png' | 'jpg' | 'webp'
  imageQuality: number
  /** x264 CRF, lower is better. */
  videoCrf: number
}

export interface ProjectFile {
  version: 1
  artboards: Artboard[]
  /** Trim is a property of the source, shared across artboards. */
  clips: Record<string, Clip>
  export: ExportPrefs
  /** Variants and compositions, by key. */
  items?: Record<string, VirtualItem>
}

export interface AssetEntry {
  name: string
  path: string
  kind: MediaKind
  size: number
  mtime: number
}

/** A subfolder the scan left out: Reframe's own exports, or one the user excluded. */
export interface SkippedFolder {
  /** Relative to the open folder, "/"-separated. */
  path: string
  reason: 'export' | 'excluded'
}

export interface FolderScan {
  dir: string
  assets: AssetEntry[]
  project: ProjectFile | null
  skipped: SkippedFolder[]
  /** Stopped at the file limit; some media wasn't included. */
  truncated: boolean
}

export interface ColorMeta {
  matrix: 'bt709' | 'bt601' | 'bt2020' | 'smpte240m' | 'fcc'
  range: 'tv' | 'pc'
}

export interface VideoExportJob {
  id: string
  input: string
  output: string
  width: number
  height: number
  srcWidth: number
  srcHeight: number
  color?: ColorMeta
  settings: CropSettings
  clip: Clip
  duration: number
  crf: number
}

/** One video cell of a composition export, framed into its rectangle like an artboard of that size. */
export interface LayerJob {
  input: string
  x: number
  y: number
  width: number
  height: number
  srcWidth: number
  srcHeight: number
  color?: ColorMeta
  settings: CropSettings
  clip: Clip
  /** Seconds the clip runs (after the trim). */
  length: number
  end: 'loop' | 'hold'
}

/**
 * A composition with video in it. Everything that doesn't move (background, images, rounded corners) is
 * drawn by the renderer into `layer`, a PNG with holes where the videos show through.
 */
export interface CompositionExportJob {
  id: string
  output: string
  width: number
  height: number
  bgColor: string
  layer: Uint8Array
  cells: LayerJob[]
  duration: number
  fps: number
  crf: number
}

export interface ExportProgress {
  id: string
  progress: number
}

export interface PosterResult {
  data: Uint8Array
  duration: number
  color: ColorMeta
  /** Has an audio stream. */
  audio: boolean
  /** Frame rate (average), or 0 if unknown. */
  fps: number
}

/** One published release, newer than the running build. `body` is GitHub's Markdown, as written. */
export interface ReleaseNote {
  version: string
  name: string
  date: string
  body: string
}

/**
 * The installed Windows app updating itself: idle (or not applicable), downloading, downloaded and
 * waiting for a restart, or failed (fall back to the download link).
 */
export type UpdateStatus =
  { state: 'idle' } | { state: 'downloading'; version: string; percent: number } | { state: 'ready'; version: string } | { state: 'failed' }

/** What's over the page: nothing, or a modal's dimmed backdrop. */
export type OverlayTint = 'none' | 'dim'

export interface ReframeApi {
  platform: NodeJS.Platform
  openFolder(): Promise<FolderScan | null>
  scanFolder(dir: string): Promise<FolderScan>
  lastFolder(): Promise<string | null>
  /** Scans the open folder again (after files changed). */
  rescanFolder(): Promise<FolderScan | null>
  /** Leaves a subfolder (relative to the open folder) out of the project, or brings it back. */
  excludeFolder(rel: string): Promise<void>
  includeFolder(rel: string): Promise<void>
  /** Marks export destinations as output, so their files are never scanned as assets. */
  markOutput(dirs: string[]): Promise<void>
  /** Recently opened folders that still exist, newest first. */
  recentFolders(): Promise<string[]>
  /** Removes a folder from the recent list; returns the updated list. */
  forgetFolder(dir: string): Promise<string[]>
  /** A folder to open, chosen from the taskbar jump list or the Dock menu. */
  onOpenFolderRequest(cb: (dir: string) => void): () => void
  saveProject(dir: string, project: ProjectFile): Promise<void>
  chooseExportDir(defaultPath?: string): Promise<string | null>
  writeFile(path: string, data: ArrayBuffer): Promise<void>
  exportVideo(job: VideoExportJob): Promise<void>
  exportComposition(job: CompositionExportJob): Promise<void>
  cancelExport(): Promise<void>
  poster(path: string): Promise<PosterResult>
  /**
   * A frame decoded the way export decodes it, as JPEG, no bigger than `edge` if given. A newer
   * request with the same `tag` stops the older one still decoding, which then gives null.
   */
  frame(path: string, time: number, color?: ColorMeta, tag?: string, edge?: number): Promise<Uint8Array | null>
  /**
   * Path of a playback copy `edge` pixels on its long side (every frame a keyframe), made on first
   * request (one at a time; `background` ones at low priority), with progress reported under `id`.
   * `stream`: also written as a fragmented MP4 that plays while it's made (its path comes with the
   * progress). Kept between sessions. Null: stopped (see cancelCopy) before it was done.
   */
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
  /** Which of these copies are made already (their paths, or null), making none. */
  copiesMade(list: { path: string; edge: number }[]): Promise<(string | null)[]>
  /** Stops the copy being made; its request gives null. */
  cancelCopy(): Promise<void>
  /** What the caches (posters, playback copies) hold, in bytes. */
  cacheSize(): Promise<number>
  /** Empties the caches; gives how many bytes went. */
  clearCache(): Promise<number>
  onCopyProgress(cb: (p: { id: number; progress: number; stream?: string }) => void): () => void
  reveal(path: string): Promise<void>
  /** Newer GitHub release than this build, if any. */
  checkUpdate(): Promise<{ version: string; notes: ReleaseNote[]; status: UpdateStatus } | null>
  onUpdateStatus(cb: (s: UpdateStatus) => void): () => void
  /** Restarts into the downloaded update. */
  installUpdate(): Promise<void>
  openRelease(): Promise<void>
  /** 0..1 shows progress on the taskbar / Dock icon; -1 clears it. */
  setProgress(p: number): Promise<void>
  focusWindow(): Promise<void>
  /** Tints the OS-drawn window controls to match what the page lays over itself. */
  setOverlayTint(tint: OverlayTint): Promise<void>
  pathForFile(file: File): string
  onExportProgress(cb: (p: ExportProgress) => void): () => void
  onFolderChanged(cb: () => void): () => void
  /** The user started dragging the window. */
  onWindowMoving(cb: () => void): () => void
}
