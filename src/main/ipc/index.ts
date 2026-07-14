import { app, BrowserWindow, clipboard, dialog, ipcMain, nativeImage, shell } from 'electron'
import fs from 'fs'
import path from 'path'
import exifr from 'exifr'
import * as db from '../database'
import * as fileOps from '../file-ops'
import { scanAllFolders, discoverSubfolders } from '../scanner'
import { clearCache, cacheSizeBytes, cacheDir, ensureThumb, thumbPath, ensureCacheDirs } from '../thumbnails'

export function registerIpc(win: BrowserWindow): void {
  // ----- window controls -----
  ipcMain.on('window:minimize', () => win.minimize())
  ipcMain.on('window:maximize', () => (win.isMaximized() ? win.unmaximize() : win.maximize()))
  ipcMain.on('window:close', () => win.close())
  ipcMain.handle('window:isMaximized', () => win.isMaximized())
  win.on('maximize', () => win.webContents.send('window:maximized', true))
  win.on('unmaximize', () => win.webContents.send('window:maximized', false))

  // ----- library -----
  ipcMain.handle('library:query', (_e, q) => db.queryPhotos(q))
  ipcMain.handle('library:folders', () => db.listFolders())
  ipcMain.handle('library:subfolders', () => discoverSubfolders())
  ipcMain.handle('library:addFolder', async () => {
    const res = await dialog.showOpenDialog(win, { properties: ['openDirectory'] })
    if (res.canceled || !res.filePaths.length) return null
    const folder = db.addFolder(res.filePaths[0])
    scanAllFolders(win)
    return folder
  })
  ipcMain.handle('library:removeFolder', (_e, id: number) => {
    db.removeFolder(id)
    win.webContents.send('library:changed')
  })
  ipcMain.handle('library:rescan', () => scanAllFolders(win))
  ipcMain.handle('library:markViewed', (_e, id: number) => db.markViewed(id))
  ipcMain.handle('library:setFavorite', (_e, ids: number[], fav: boolean) => {
    db.setFavorite(ids, fav)
    win.webContents.send('library:changed')
  })
  ipcMain.handle('thumb:ensure', (_e, id: number, sizes: ('small' | 'medium' | 'large')[]) => ensureThumb(id, sizes, win))

  // renderer captured a video frame -> save as this video's thumbnail set
  ipcMain.handle('thumb:saveVideoFrame', (_e, photoId: number, hash: string, dataUrl: string, duration?: number) => {
    ensureCacheDirs()
    const b64 = dataUrl.replace(/^data:image\/\w+;base64,/, '')
    const buf = Buffer.from(b64, 'base64')
    for (const size of ['small', 'medium', 'large']) {
      const p = thumbPath(size, hash)
      if (!fs.existsSync(p)) fs.writeFileSync(p, buf)
    }
    if (duration && Number.isFinite(duration)) {
      db.getDb().prepare('UPDATE photos SET duration = ? WHERE id = ?').run(duration, photoId)
    }
    win.webContents.send('thumb:done', photoId)
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
  ipcMain.handle('photo:showInExplorer', (_e, filePath: string) => shell.showItemInFolder(filePath))
  ipcMain.handle('photo:copyToClipboard', (_e, filePath: string) => {
    const img = nativeImage.createFromPath(filePath)
    if (!img.isEmpty()) clipboard.writeImage(img)
    else clipboard.writeText(filePath)
  })

  // ----- file ops -----
  ipcMain.handle('files:trash', (_e, ids: number[]) => {
    fileOps.moveToTrash(ids)
    win.webContents.send('library:changed')
  })
  ipcMain.handle('files:restore', (_e, ids: number[]) => {
    fileOps.restoreFromTrash(ids)
    win.webContents.send('library:changed')
  })
  ipcMain.handle('files:deleteForever', (_e, ids: number[]) => {
    fileOps.deletePermanently(ids)
    win.webContents.send('library:changed')
  })
  ipcMain.handle('files:rename', (_e, id: number, name: string) => {
    const err = fileOps.renamePhoto(id, name)
    if (!err) win.webContents.send('library:changed')
    return err
  })
  ipcMain.handle('files:move', async (_e, ids: number[]) => {
    const res = await dialog.showOpenDialog(win, { properties: ['openDirectory'], title: 'Move to folder' })
    if (res.canceled || !res.filePaths.length) return
    fileOps.movePhotos(ids, res.filePaths[0])
    win.webContents.send('library:changed')
  })
  ipcMain.handle('files:copy', async (_e, ids: number[]) => {
    const res = await dialog.showOpenDialog(win, { properties: ['openDirectory'], title: 'Copy to folder' })
    if (res.canceled || !res.filePaths.length) return
    fileOps.copyPhotos(ids, res.filePaths[0])
  })
  ipcMain.handle('files:undo', () => {
    const did = fileOps.undoLast()
    if (did) win.webContents.send('library:changed')
    return did
  })

  // save an edited image next to the original (non-destructive)
  ipcMain.handle('files:saveEdited', (_e, originalPath: string, dataUrl: string) => {
    const b64 = dataUrl.replace(/^data:image\/\w+;base64,/, '')
    const ext = path.extname(originalPath)
    const base = path.basename(originalPath, ext)
    const dir = path.dirname(originalPath)
    let dest = path.join(dir, `${base} (edited).jpg`)
    let i = 1
    while (fs.existsSync(dest)) {
      dest = path.join(dir, `${base} (edited ${i}).jpg`)
      i++
    }
    fs.writeFileSync(dest, Buffer.from(b64, 'base64'))
    scanAllFolders(win)
    return dest
  })

  // ----- settings -----
  ipcMain.handle('settings:get', () => db.getSettings())
  ipcMain.handle('settings:set', (_e, key: string, value: unknown) => db.setSetting(key, value))
  ipcMain.handle('settings:cacheSize', () => cacheSizeBytes())
  ipcMain.handle('settings:clearCache', () => clearCache())
  ipcMain.handle('settings:cacheDir', () => cacheDir())
  ipcMain.handle('app:version', () => app.getVersion())
}
