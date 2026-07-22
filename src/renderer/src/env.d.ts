/// <reference types="vite/client" />
import type { Photo, SourceFolder, Album, Settings, ScanProgress, PhotoMeta, ThumbPx } from '@shared/types'

export interface DriftApi {
  minimize(): void
  maximize(): void
  close(): void
  isMaximized(): Promise<boolean>
  onMaximized(cb: (max: boolean) => void): () => void

  queryPhotos(q: unknown): Promise<Photo[]>
  listFolders(): Promise<SourceFolder[]>
  listSubfolders(): Promise<{ folderId: number; path: string; name: string; depth: number }[]>
  addFolder(): Promise<SourceFolder | null>
  removeFolder(id: number): Promise<void>
  rescan(): Promise<void>
  markViewed(id: number): Promise<void>
  setFavorite(ids: number[], fav: boolean): Promise<void>
  ensureThumb(id: number, sizes: string[]): Promise<void>
  saveVideoFrame(photoId: number, hash: string, dataUrl: string, duration?: number): Promise<void>
  /** Fire-and-forget: report currently visible photo ids and the requested pixel bucket. */
  thumbViewport(ids: number[], px: ThumbPx): void

  listAlbums(): Promise<Album[]>
  createAlbum(name: string): Promise<Album>
  renameAlbum(id: number, name: string): Promise<void>
  deleteAlbum(id: number): Promise<void>
  setAlbumCover(albumId: number, photoId: number): Promise<void>
  addToAlbum(albumId: number, ids: number[]): Promise<void>
  removeFromAlbum(albumId: number, ids: number[]): Promise<void>
  reorderAlbum(albumId: number, ids: number[]): Promise<void>

  listTags(): Promise<string[]>
  tagsForPhoto(id: number): Promise<string[]>
  addTag(id: number, tag: string): Promise<void>
  removeTag(id: number, tag: string): Promise<void>

  photoMeta(id: number): Promise<PhotoMeta | null>
  showInExplorer(p: string): Promise<void>
  copyToClipboard(p: string): Promise<void>

  trashPhotos(ids: number[]): Promise<void>
  restorePhotos(ids: number[]): Promise<void>
  deleteForever(ids: number[]): Promise<void>
  renamePhoto(id: number, name: string): Promise<string | null>
  movePhotos(ids: number[]): Promise<void>
  copyPhotos(ids: number[]): Promise<void>
  undo(): Promise<boolean>
  saveEdited(originalPath: string, dataUrl: string): Promise<string>

  getSettings(): Promise<Settings>
  setSetting(key: string, value: unknown): Promise<void>
  cacheSize(): Promise<number>
  clearCache(): Promise<void>
  appVersion(): Promise<string>

  onScanProgress(cb: (p: ScanProgress) => void): () => void
  onLibraryChanged(cb: () => void): () => void
  onThumbDone(cb: (id: number) => void): () => void
}

declare global {
  interface Window {
    drift: DriftApi
  }
}
