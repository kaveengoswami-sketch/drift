import { contextBridge, ipcRenderer } from 'electron'

const api = {
  // window
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),
  isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  onMaximized: (cb: (max: boolean) => void) => {
    const fn = (_: unknown, max: boolean): void => cb(max)
    ipcRenderer.on('window:maximized', fn)
    return () => ipcRenderer.removeListener('window:maximized', fn)
  },

  // library
  queryPhotos: (q: unknown) => ipcRenderer.invoke('library:query', q),
  listFolders: () => ipcRenderer.invoke('library:folders'),
  listSubfolders: () => ipcRenderer.invoke('library:subfolders'),
  addFolder: () => ipcRenderer.invoke('library:addFolder'),
  removeFolder: (id: number) => ipcRenderer.invoke('library:removeFolder', id),
  rescan: () => ipcRenderer.invoke('library:rescan'),
  markViewed: (id: number) => ipcRenderer.invoke('library:markViewed', id),
  setFavorite: (ids: number[], fav: boolean) => ipcRenderer.invoke('library:setFavorite', ids, fav),
  ensureThumb: (id: number, sizes: string[]) => ipcRenderer.invoke('thumb:ensure', id, sizes),
  saveVideoFrame: (photoId: number, hash: string, dataUrl: string, duration?: number) =>
    ipcRenderer.invoke('thumb:saveVideoFrame', photoId, hash, dataUrl, duration),
  thumbViewport: (ids: number[], px: number) => ipcRenderer.send('thumb:viewport', ids, px),

  // albums
  listAlbums: () => ipcRenderer.invoke('albums:list'),
  createAlbum: (name: string) => ipcRenderer.invoke('albums:create', name),
  renameAlbum: (id: number, name: string) => ipcRenderer.invoke('albums:rename', id, name),
  deleteAlbum: (id: number) => ipcRenderer.invoke('albums:delete', id),
  setAlbumCover: (albumId: number, photoId: number) => ipcRenderer.invoke('albums:setCover', albumId, photoId),
  addToAlbum: (albumId: number, ids: number[]) => ipcRenderer.invoke('albums:add', albumId, ids),
  removeFromAlbum: (albumId: number, ids: number[]) => ipcRenderer.invoke('albums:remove', albumId, ids),
  reorderAlbum: (albumId: number, ids: number[]) => ipcRenderer.invoke('albums:reorder', albumId, ids),

  // tags
  listTags: () => ipcRenderer.invoke('tags:list'),
  tagsForPhoto: (id: number) => ipcRenderer.invoke('tags:forPhoto', id),
  addTag: (id: number, tag: string) => ipcRenderer.invoke('tags:add', id, tag),
  removeTag: (id: number, tag: string) => ipcRenderer.invoke('tags:remove', id, tag),

  // photo
  photoMeta: (id: number) => ipcRenderer.invoke('photo:meta', id),
  showInExplorer: (p: string) => ipcRenderer.invoke('photo:showInExplorer', p),
  copyToClipboard: (p: string) => ipcRenderer.invoke('photo:copyToClipboard', p),

  // file ops
  trashPhotos: (ids: number[]) => ipcRenderer.invoke('files:trash', ids),
  restorePhotos: (ids: number[]) => ipcRenderer.invoke('files:restore', ids),
  deleteForever: (ids: number[]) => ipcRenderer.invoke('files:deleteForever', ids),
  renamePhoto: (id: number, name: string) => ipcRenderer.invoke('files:rename', id, name),
  movePhotos: (ids: number[]) => ipcRenderer.invoke('files:move', ids),
  copyPhotos: (ids: number[]) => ipcRenderer.invoke('files:copy', ids),
  undo: () => ipcRenderer.invoke('files:undo'),
  saveEdited: (originalPath: string, dataUrl: string) => ipcRenderer.invoke('files:saveEdited', originalPath, dataUrl),

  // settings
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSetting: (key: string, value: unknown) => ipcRenderer.invoke('settings:set', key, value),
  cacheSize: () => ipcRenderer.invoke('settings:cacheSize'),
  clearCache: () => ipcRenderer.invoke('settings:clearCache'),
  appVersion: () => ipcRenderer.invoke('app:version'),

  // faces & people
  listPeople: () => ipcRenderer.invoke('faces:listPeople'),
  getPerson: (id: number) => ipcRenderer.invoke('faces:getPerson', id),
  facesForPhoto: (photoId: number) => ipcRenderer.invoke('faces:listForPhoto', photoId),
  photosForPerson: (personId: number) => ipcRenderer.invoke('faces:listPhotosForPerson', personId),
  namePerson: (personId: number, name: string) => ipcRenderer.invoke('faces:namePerson', personId, name),
  mergePeople: (targetPersonId: number, sourcePersonId: number) =>
    ipcRenderer.invoke('faces:mergePeople', targetPersonId, sourcePersonId),
  detachFace: (faceId: number) => ipcRenderer.invoke('faces:detachFace', faceId),
  startFaceScan: () => ipcRenderer.invoke('faces:startScan'),
  cancelFaceScan: () => ipcRenderer.invoke('faces:cancelScan'),
  getFaceScanProgress: () => ipcRenderer.invoke('faces:getScanProgress'),
  onFaceScanProgress: (cb: (progress: unknown) => void) => {
    const fn = (_: unknown, p: unknown): void => cb(p)
    ipcRenderer.on('faces:progress', fn)
    return () => ipcRenderer.removeListener('faces:progress', fn)
  },

  // events
  onScanProgress: (cb: (p: unknown) => void) => {
    const fn = (_: unknown, p: unknown): void => cb(p)
    ipcRenderer.on('scan:progress', fn)
    return () => ipcRenderer.removeListener('scan:progress', fn)
  },
  onLibraryChanged: (cb: () => void) => {
    const fn = (): void => cb()
    ipcRenderer.on('library:changed', fn)
    return () => ipcRenderer.removeListener('library:changed', fn)
  },
  onThumbDone: (cb: (id: number) => void) => {
    const fn = (_: unknown, id: number): void => cb(id)
    ipcRenderer.on('thumb:done', fn)
    return () => ipcRenderer.removeListener('thumb:done', fn)
  }
}

contextBridge.exposeInMainWorld('drift', api)

export type DriftApi = typeof api
