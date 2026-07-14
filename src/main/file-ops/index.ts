import fs from 'fs'
import path from 'path'
import * as db from '../database'

/** Hidden trash folder lives inside the photo's source folder root */
function trashDirFor(sourceFolderPath: string): string {
  const dir = path.join(sourceFolderPath, '.drift-trash')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function uniqueDest(dir: string, filename: string): string {
  let dest = path.join(dir, filename)
  if (!fs.existsSync(dest)) return dest
  const ext = path.extname(filename)
  const base = path.basename(filename, ext)
  let i = 1
  while (fs.existsSync(dest)) {
    dest = path.join(dir, `${base} (${i})${ext}`)
    i++
  }
  return dest
}

interface UndoEntry {
  kind: 'rename' | 'move' | 'trash'
  items: { photoId: number; from: string; to: string }[]
}

let lastOp: UndoEntry | null = null

export function moveToTrash(photoIds: number[]): void {
  const folders = new Map(db.listFolders().map((f) => [f.id, f.path]))
  const undo: UndoEntry = { kind: 'trash', items: [] }
  for (const id of photoIds) {
    const photo = db.getPhoto(id)
    if (!photo || photo.trashedAt) continue
    const root = folders.get(photo.folderId)
    if (!root) continue
    const dest = uniqueDest(trashDirFor(root), photo.filename)
    try {
      fs.renameSync(photo.path, dest)
      db.markTrashed(id, dest, photo.path)
      undo.items.push({ photoId: id, from: photo.path, to: dest })
    } catch (e) {
      console.error('trash failed', photo.path, e)
    }
  }
  if (undo.items.length) lastOp = undo
}

export function restoreFromTrash(photoIds: number[]): void {
  for (const id of photoIds) {
    const photo = db.getPhoto(id)
    if (!photo || !photo.trashedAt || !photo.trashOriginalPath) continue
    const dest = fs.existsSync(photo.trashOriginalPath)
      ? uniqueDest(path.dirname(photo.trashOriginalPath), photo.filename)
      : photo.trashOriginalPath
    try {
      fs.mkdirSync(path.dirname(dest), { recursive: true })
      fs.renameSync(photo.path, dest)
      db.markRestored(id, dest)
    } catch (e) {
      console.error('restore failed', photo.path, e)
    }
  }
}

export function deletePermanently(photoIds: number[]): void {
  for (const id of photoIds) {
    const photo = db.getPhoto(id)
    if (!photo) continue
    try {
      fs.rmSync(photo.path, { force: true })
    } catch {
      // already gone
    }
    db.deletePhotoRow(id)
  }
}

export function renamePhoto(photoId: number, newName: string): string | null {
  const photo = db.getPhoto(photoId)
  if (!photo) return null
  const ext = path.extname(photo.filename)
  const finalName = newName.endsWith(ext) ? newName : newName + ext
  const dest = path.join(path.dirname(photo.path), finalName)
  if (fs.existsSync(dest)) return 'A file with that name already exists.'
  fs.renameSync(photo.path, dest)
  lastOp = { kind: 'rename', items: [{ photoId, from: photo.path, to: dest }] }
  db.updatePhotoPath(photoId, dest, finalName)
  return null
}

export function movePhotos(photoIds: number[], destDir: string): void {
  const undo: UndoEntry = { kind: 'move', items: [] }
  for (const id of photoIds) {
    const photo = db.getPhoto(id)
    if (!photo) continue
    const dest = uniqueDest(destDir, photo.filename)
    try {
      fs.renameSync(photo.path, dest)
      db.updatePhotoPath(id, dest, path.basename(dest))
      undo.items.push({ photoId: id, from: photo.path, to: dest })
    } catch (e) {
      console.error('move failed', photo.path, e)
    }
  }
  if (undo.items.length) lastOp = undo
}

export function copyPhotos(photoIds: number[], destDir: string): void {
  for (const id of photoIds) {
    const photo = db.getPhoto(id)
    if (!photo) continue
    try {
      fs.copyFileSync(photo.path, uniqueDest(destDir, photo.filename))
    } catch (e) {
      console.error('copy failed', photo.path, e)
    }
  }
}

export function undoLast(): boolean {
  if (!lastOp) return false
  const op = lastOp
  lastOp = null
  for (const item of op.items) {
    try {
      fs.renameSync(item.to, item.from)
      if (op.kind === 'trash') {
        db.markRestored(item.photoId, item.from)
      } else {
        db.updatePhotoPath(item.photoId, item.from, path.basename(item.from))
      }
    } catch (e) {
      console.error('undo failed', item, e)
    }
  }
  return true
}
