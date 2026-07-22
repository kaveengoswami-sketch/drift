import { app, BrowserWindow, clipboard, dialog, ipcMain, nativeImage, shell } from 'electron'
import fs from 'fs'
import path from 'path'
import exifr from 'exifr'
import { DEFAULT_SETTINGS, THUMB_LADDER, type ThumbPx, type CopyResult } from '@shared/types'
import * as db from '../database'
import * as fileOps from '../file-ops'
import { scanAllFolders, discoverSubfolders } from '../scanner'
import { clearCache, cacheSizeBytes, cacheDir, ensureThumb, thumbPath, ensureCacheDirs, setViewport } from '../thumbnails'
import * as faces from '../faces'

// Handlers that turn a renderer-supplied string into a filesystem write or a
// shell action resolve it against what the library actually indexed first.
// The renderer only ever echoes back a path it received from the DB, so an
// exact match is the correct check — and it means a compromised renderer can't
// aim these at arbitrary files.
function knownPhotoPath(filePath: unknown): string | null {
  if (typeof filePath !== 'string' || !filePath) return null
  const row = db.getDb().prepare('SELECT path FROM photos WHERE path = ? LIMIT 1').get(filePath) as unknown as
    | { path: string }
    | undefined
  return row ? row.path : null
}

const SETTING_KEYS = new Set(Object.keys(DEFAULT_SETTINGS))

// ipcMain.handle throws on a duplicate channel, so the handler block registers
// exactly once per process. Handlers therefore can't close over a specific
// window — they go through this reference, which each new window updates.
let activeWin: BrowserWindow
let registered = false

function send(channel: string, ...args: unknown[]): void {
  if (!activeWin || activeWin.isDestroyed() || activeWin.webContents.isDestroyed()) return
  try {
    activeWin.webContents.send(channel, ...args)
  } catch {
    // render frame torn down mid-send
  }
}

export function registerIpc(win: BrowserWindow): void {
  activeWin = win
  win.on('maximize', () => send('window:maximized', true))
  win.on('unmaximize', () => send('window:maximized', false))
  if (registered) return
  registered = true

  // ----- window controls -----
  ipcMain.on('window:minimize', () => activeWin?.minimize())
  ipcMain.on('window:maximize', () => (activeWin?.isMaximized() ? activeWin.unmaximize() : activeWin?.maximize()))
  ipcMain.on('window:close', () => activeWin?.close())
  ipcMain.handle('window:isMaximized', () => activeWin?.isMaximized() ?? false)

  // ----- library -----
  ipcMain.handle('library:query', (_e, q) => db.queryPhotos(q))
  ipcMain.handle('library:folders', () => db.listFolders())
  ipcMain.handle('library:subfolders', () => discoverSubfolders())
  ipcMain.handle('library:addFolder', async () => {
    const res = await dialog.showOpenDialog(activeWin, { properties: ['openDirectory'] })
    if (res.canceled || !res.filePaths.length) return null
    const folder = db.addFolder(res.filePaths[0])
    scanAllFolders(activeWin)
    return folder
  })
  ipcMain.handle('library:removeFolder', (_e, id: number) => {
    db.removeFolder(id)
    send('library:changed')
  })
  ipcMain.handle('library:rescan', () => scanAllFolders(activeWin))
  ipcMain.handle('library:markViewed', (_e, id: number) => db.markViewed(id))
  ipcMain.handle('library:setFavorite', (_e, ids: number[], fav: boolean) => {
    db.setFavorite(ids, fav)
    send('library:changed')
  })
  ipcMain.handle('thumb:ensure', (_e, id: number, sizes: string[]) => ensureThumb(id, sizes, activeWin))

  // viewport report from renderer: fire-and-forget, no ipcRenderer.invoke
  ipcMain.on('thumb:viewport', (_e, ids: unknown, px: unknown) => {
    if (!Array.isArray(ids) || !ids.every((x) => typeof x === 'number')) return
    if (!(THUMB_LADDER as readonly number[]).includes(px as number)) return
    setViewport(activeWin, ids as number[], px as ThumbPx)
  })

  // renderer captured a video frame -> save as this video's thumbnail set
  ipcMain.handle('thumb:saveVideoFrame', (_e, photoId: number, _hash: string, dataUrl: string, duration?: number) => {
    // The hash is taken from the DB row, never from the renderer — it becomes a
    // filename, so accepting it verbatim would let the renderer write outside
    // the cache directory.
    const photo = db.getPhoto(photoId)
    if (!photo || photo.type !== 'video') return
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) return
    ensureCacheDirs()
    const b64 = dataUrl.replace(/^data:image\/\w+;base64,/, '')
    const buf = Buffer.from(b64, 'base64')
    if (!buf.length) return
    // Write to every bucket so any ladder rung that requests this video thumb finds it.
    for (const px of THUMB_LADDER) {
      const p = thumbPath(px, photo.hash)
      try {
        if (!fs.existsSync(p)) fs.writeFileSync(p, buf)
      } catch {
        // cache write failed — the tile just stays a placeholder
      }
    }
    if (duration && Number.isFinite(duration)) {
      db.getDb().prepare('UPDATE photos SET duration = ? WHERE id = ?').run(duration, photoId)
    }
    send('thumb:done', photoId)
  })

  // ----- albums -----
  ipcMain.handle('albums:list', () => db.listAlbums())
  ipcMain.handle('albums:create', (_e, name: string) => db.createAlbum(name))
  ipcMain.handle('albums:rename', (_e, id: number, name: string) => db.renameAlbum(id, name))
  ipcMain.handle('albums:delete', (_e, id: number) => db.deleteAlbum(id))
  ipcMain.handle('albums:setCover', (_e, albumId: number, photoId: number) => db.setAlbumCover(albumId, photoId))
  ipcMain.handle('albums:add', (_e, albumId: number, photoIds: number[]) => db.addToAlbum(albumId, photoIds))
  ipcMain.handle('albums:remove', (_e, albumId: number, photoIds: number[]) => db.removeFromAlbum(albumId, photoIds))
  ipcMain.handle('albums:reorder', (_e, albumId: number, ids: number[]) => db.reorderAlbum(albumId, ids))

  // ----- tags -----
  ipcMain.handle('tags:list', () => db.listTags())
  ipcMain.handle('tags:forPhoto', (_e, id: number) => db.getPhotoTags(id))
  ipcMain.handle('tags:add', (_e, id: number, tag: string) => db.addTag(id, tag))
  ipcMain.handle('tags:remove', (_e, id: number, tag: string) => db.removeTag(id, tag))

  // ----- photo info -----
  ipcMain.handle('photo:meta', async (_e, id: number) => {
    const photo = db.getPhoto(id)
    if (!photo) return null
    let exif: Record<string, unknown> | undefined
    try {
      exif = await exifr.parse(photo.path, {
        pick: ['Make', 'Model', 'FNumber', 'ExposureTime', 'ISO', 'FocalLength', 'LensModel', 'DateTimeOriginal']
      })
    } catch {
      // no EXIF available
    }
    return { tags: db.getPhotoTags(id), albums: db.getAlbumsForPhoto(id), exif }
  })
  ipcMain.handle('photo:showInExplorer', (_e, filePath: string) => {
    const known = knownPhotoPath(filePath)
    if (known) shell.showItemInFolder(known)
  })
  // Returns what actually landed on the clipboard so the renderer can show a
  // toast instead of leaving the user staring at a button that did nothing.
  ipcMain.handle('photo:copyToClipboard', (_e, filePath: string): CopyResult => {
    const known = knownPhotoPath(filePath)
    if (!known) return { ok: false, kind: 'none', error: 'Photo not found in library' }
    try {
      let img = nativeImage.createFromPath(known)
      if (img.isEmpty()) {
        clipboard.writeText(known)
        return { ok: true, kind: 'path' }
      }
      // Very large decodes are slow to hand to other apps; cap the long edge.
      const { width, height } = img.getSize()
      const MAX_EDGE = 4096
      if (Math.max(width, height) > MAX_EDGE) {
        img = width >= height ? img.resize({ width: MAX_EDGE }) : img.resize({ height: MAX_EDGE })
      }
      clipboard.clear()
      clipboard.writeImage(img)
      if (clipboard.readImage().isEmpty()) {
        clipboard.writeText(known)
        return { ok: true, kind: 'path' }
      }
      return { ok: true, kind: 'image' }
    } catch (err) {
      return { ok: false, kind: 'none', error: err instanceof Error ? err.message : String(err) }
    }
  })

  // ----- file ops -----
  ipcMain.handle('files:trash', (_e, ids: number[]) => {
    fileOps.moveToTrash(ids)
    send('library:changed')
  })
  ipcMain.handle('files:restore', (_e, ids: number[]) => {
    fileOps.restoreFromTrash(ids)
    send('library:changed')
  })
  ipcMain.handle('files:deleteForever', (_e, ids: number[]) => {
    fileOps.deletePermanently(ids)
    send('library:changed')
  })
  ipcMain.handle('files:rename', (_e, id: number, name: string) => {
    const err = fileOps.renamePhoto(id, name)
    if (!err) send('library:changed')
    return err
  })
  ipcMain.handle('files:move', async (_e, ids: number[]) => {
    const res = await dialog.showOpenDialog(activeWin, { properties: ['openDirectory'], title: 'Move to folder' })
    if (res.canceled || !res.filePaths.length) return
    fileOps.movePhotos(ids, res.filePaths[0])
    send('library:changed')
  })
  ipcMain.handle('files:copy', async (_e, ids: number[]) => {
    const res = await dialog.showOpenDialog(activeWin, { properties: ['openDirectory'], title: 'Copy to folder' })
    if (res.canceled || !res.filePaths.length) return
    fileOps.copyPhotos(ids, res.filePaths[0])
  })
  ipcMain.handle('files:undo', () => {
    const did = fileOps.undoLast()
    if (did) send('library:changed')
    return did
  })

  // save an edited image next to the original (non-destructive)
  ipcMain.handle('files:saveEdited', (_e, originalPath: string, dataUrl: string) => {
    // Writes a new file to disk, so the destination is derived from an indexed
    // photo's path rather than from whatever string the renderer sent.
    const known = knownPhotoPath(originalPath)
    if (!known) return null
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) return null
    const b64 = dataUrl.replace(/^data:image\/\w+;base64,/, '')
    const buf = Buffer.from(b64, 'base64')
    if (!buf.length) return null
    const ext = path.extname(known)
    const base = path.basename(known, ext)
    const dir = path.dirname(known)
    let dest = path.join(dir, `${base} (edited).jpg`)
    let i = 1
    while (fs.existsSync(dest)) {
      dest = path.join(dir, `${base} (edited ${i}).jpg`)
      i++
    }
    try {
      fs.writeFileSync(dest, buf)
    } catch {
      return null
    }
    scanAllFolders(activeWin)
    return dest
  })

  // ----- settings -----
  ipcMain.handle('settings:get', () => db.getSettings())
  ipcMain.handle('settings:set', (_e, key: string, value: unknown) => {
    // settings keys become row keys — only accept ones the app actually defines
    if (!SETTING_KEYS.has(key)) return
    db.setSetting(key, value)
  })
  ipcMain.handle('settings:cacheSize', () => cacheSizeBytes())
  ipcMain.handle('settings:clearCache', () => clearCache())
  ipcMain.handle('settings:cacheDir', () => cacheDir())
  ipcMain.handle('app:version', () => app.getVersion())

  // ----- faces & people -----
  ipcMain.handle('faces:listPeople', () => db.listPeople())
  ipcMain.handle('faces:getPerson', (_e, id: number) => db.getPerson(id))
  ipcMain.handle('faces:listForPhoto', (_e, photoId: number) => db.listFacesForPhoto(photoId))
  ipcMain.handle('faces:listPhotosForPerson', (_e, personId: number) => db.listPhotosForPerson(personId))
  ipcMain.handle('faces:namePerson', (_e, personId: number, name: string) => {
    db.namePerson(personId, name)
    send('library:changed')
  })
  ipcMain.handle('faces:mergePeople', (_e, targetPersonId: number, sourcePersonId: number) => {
    db.mergePeople(targetPersonId, sourcePersonId)
    send('library:changed')
  })
  ipcMain.handle('faces:detachFace', (_e, faceId: number) => {
    db.detachFace(faceId)
    send('library:changed')
  })
  ipcMain.handle('faces:startScan', () => faces.startFaceScan(activeWin))
  ipcMain.handle('faces:cancelScan', () => faces.cancelFaceScan())
  ipcMain.handle('faces:getScanProgress', () => faces.getScanProgress())
}
