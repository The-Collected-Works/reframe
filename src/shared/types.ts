export type FitMode = 'fill' | 'fit' | 'width' | 'height' | 'stretch'
export type BgMode = 'color' | 'blur'
export type MediaKind = 'image' | 'video'

/** Per-artboard crop settings. Defaults live on the artboard; assets override any subset. */
export interface CropSettings {
  fit: FitMode
  /** Multiplier on the fit scale. 1 = exactly fit/fill. */
  zoom: number
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
  /** Keyed by asset file name. */
  overrides: Record<string, Partial<CropSettings>>
}

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
}

export interface AssetEntry {
  name: string
  path: string
  kind: MediaKind
  size: number
  mtime: number
}

export interface FolderScan {
  dir: string
  assets: AssetEntry[]
  project: ProjectFile | null
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

export interface ExportProgress {
  id: string
  progress: number
}

export interface PosterResult {
  data: Uint8Array
  duration: number
  color: ColorMeta
}

export interface ReframeApi {
  platform: NodeJS.Platform
  openFolder(): Promise<FolderScan | null>
  scanFolder(dir: string): Promise<FolderScan>
  lastFolder(): Promise<string | null>
  saveProject(dir: string, project: ProjectFile): Promise<void>
  chooseExportDir(defaultPath?: string): Promise<string | null>
  writeFile(path: string, data: ArrayBuffer): Promise<void>
  exportVideo(job: VideoExportJob): Promise<void>
  cancelExport(): Promise<void>
  poster(path: string): Promise<PosterResult>
  /** A frame decoded the way export decodes it, as JPEG. */
  frame(path: string, time: number, color?: ColorMeta): Promise<Uint8Array>
  reveal(path: string): Promise<void>
  /** Newer GitHub release than this build, if any. */
  checkUpdate(): Promise<{ version: string } | null>
  openRelease(): Promise<void>
  pathForFile(file: File): string
  onExportProgress(cb: (p: ExportProgress) => void): () => void
  onFolderChanged(cb: () => void): () => void
}
