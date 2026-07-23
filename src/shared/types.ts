// Shared types between main and renderer processes

export type MediaType = 'image' | 'video'

export interface Photo {
  id: number
  path: string
  filename: string
  relPath?: string
  folderId: number
  size: number
  width: number
  height: number
  type: MediaType
  /** unix ms — best available capture date (EXIF DateTimeOriginal > file created) */
  dateTaken: number
  dateModified: number
  favorite: 0 | 1
  /** unix ms when moved to trash, null if not trashed */
  trashedAt: number | null
  /** original path before trash move */
  trashOriginalPath: string | null
  /** video duration in seconds, null for images */
  duration: number | null
  /** content hash used for thumbnail cache keys */
  hash: string
  lastViewedAt: number | null
  addedAt: number
}

export interface SourceFolder {
  id: number
  path: string
  name: string
}

export interface Album {
  id: number
  name: string
  coverPhotoId: number | null
  createdAt: number
  photoCount: number
}

export interface Tag {
  id: number
  name: string
}

export interface ScanProgress {
  phase: 'scanning' | 'thumbnails' | 'done'
  scanned: number
  total: number
  currentFile?: string
}

export interface LibraryQuery {
  view: ViewKey
  albumId?: number
  folderId?: number
  folderPathPrefix?: string
  tag?: string
  search?: string
  personId?: number
  personName?: string
}

export type ViewKey =
  | 'all'
  | 'favorites'
  | 'recent-added'
  | 'recent-viewed'
  | 'videos'
  | 'trash'
  | 'album'
  | 'folder'
  | 'people'
  | 'person'

export interface Settings {
  theme: 'dark' | 'light'
  accentColor: string
  trashDays: number
  slideshowInterval: number
  animationsEnabled: boolean
  thumbnailQuality: 'standard' | 'high'
  firstRunComplete: boolean
  /** Which recogniser/crop produced the stored embeddings. See FACE_EMBED_VERSION. */
  faceEmbedVersion: number
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'dark',
  accentColor: '#F09A4B',
  trashDays: 30,
  slideshowInterval: 5,
  animationsEnabled: true,
  thumbnailQuality: 'standard',
  firstRunComplete: false,
  faceEmbedVersion: 0
}

export interface PhotoMeta {
  tags: string[]
  albums: { id: number; name: string }[]
  exif?: Record<string, unknown>
}

/** @deprecated Use THUMB_LADDER / ThumbPx instead. */
export type ThumbSize = 'small' | 'medium' | 'large'

/** Thumbnail pixel buckets. A bucket IS the long-edge pixel size. */
export const THUMB_LADDER = [128, 256, 384, 512, 768, 1024, 2048] as const
export type ThumbPx = (typeof THUMB_LADDER)[number]

/** Smallest bucket that covers `needed` device pixels. */
export function pickBucket(needed: number): ThumbPx {
  return THUMB_LADDER.find((b) => b >= needed) ?? THUMB_LADDER[THUMB_LADDER.length - 1]
}

export const IMAGE_EXTS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff', '.tif', '.svg',
  '.heic', '.heif', '.ico',
  '.cr2', '.cr3', '.nef', '.arw', '.dng', '.orf', '.rw2', '.raf', '.pef', '.srw'
])

export const RAW_EXTS = new Set([
  '.cr2', '.cr3', '.nef', '.arw', '.dng', '.orf', '.rw2', '.raf', '.pef', '.srw'
])

export const VIDEO_EXTS = new Set(['.mp4', '.mov', '.avi', '.mkv', '.webm', '.wmv'])

export interface Person {
  id: number
  name: string | null
  type: 'human' | 'pet'
  coverFaceId: number | null
  isHidden: number
  createdAt: number
  faceCount: number
  coverPhotoPath?: string | null
  coverBbox?: { x: number; y: number; w: number; h: number } | null
}

export interface Face {
  id: number
  photoId: number
  personId: number | null
  bboxX: number
  bboxY: number
  bboxW: number
  bboxH: number
  confidence: number
  detectionType: 'human' | 'cat' | 'dog'
  createdAt: number
  personName?: string | null
}

export interface FaceScanProgress {
  scanned: number
  total: number
  facesFound: number
  phase: 'idle' | 'downloading_models' | 'scanning' | 'clustering' | 'done' | 'error'
  error?: string
}


/** Outcome of a clipboard copy, so the UI can confirm what actually happened. */
export interface CopyResult {
  ok: boolean
  kind: 'image' | 'path' | 'none'
  error?: string
}
